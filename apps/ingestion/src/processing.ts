import {
  IngestionJobPayloadSchema,
  IntegrityOutcomeSchema,
} from "../../../packages/shared/src/index";
import { readBounded, sha256 } from "./mime";
import {
  backoff,
  event,
  iso,
  LEASE_MS,
  MAX_ATTEMPTS,
  PAGE_SIZE,
  WATCHDOG_MS,
  type IngestionEnv,
  type Job,
} from "./types";
export async function dispatchOutbox(
  env: IngestionEnv,
  now = Date.now(),
  limit = PAGE_SIZE,
) {
  const rows = await env.DB.prepare(
    `SELECT o.id FROM outbox o JOIN jobs j ON j.id=o.job_id JOIN messages m ON m.id=j.message_id
    WHERE o.sent_at IS NULL AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=?)
    AND (o.lease_until IS NULL OR o.lease_until<=?) AND j.stage='mime_integrity' AND j.version=1 AND j.state IN ('queued','failed') AND m.status!='deleted'
    AND NOT EXISTS(SELECT 1 FROM deletion_tombstones t WHERE t.content_sha256=m.mime_sha256)
    ORDER BY o.next_attempt_at,o.id LIMIT ?`,
  )
    .bind(iso(now), iso(now), Math.min(PAGE_SIZE, Math.max(1, limit)))
    .all<{ id: string }>();
  for (const row of rows.results) {
    const token = crypto.randomUUID();
    const claim = await env.DB.prepare(
      `UPDATE outbox SET lease_token=?,lease_until=?,attempts=MIN(attempts+1,1000000)
      WHERE id=? AND sent_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      AND (lease_until IS NULL OR lease_until<=?) RETURNING job_id,attempts`,
    )
      .bind(token, iso(now + LEASE_MS), row.id, iso(now), iso(now))
      .first<{ job_id: string; attempts: number }>();
    if (!claim) continue;
    try {
      await env.INGESTION_QUEUE.send({ jobId: claim.job_id });
      // Consumer might have already completed/failed and invalidated this dispatch token.
      await env.DB.prepare(
        "UPDATE outbox SET sent_at=?,lease_token=NULL,lease_until=NULL,error_code=NULL,next_attempt_at=? WHERE id=? AND lease_token=?",
      )
        .bind(iso(now), iso(now + WATCHDOG_MS), row.id, token)
        .run();
      event("OUTBOX_SENT");
    } catch {
      await env.DB.prepare(
        "UPDATE outbox SET lease_token=NULL,lease_until=NULL,error_code='QUEUE_UNAVAILABLE',next_attempt_at=? WHERE id=? AND lease_token=?",
      )
        .bind(iso(now + backoff(claim.attempts) * 1000), row.id, token)
        .run();
      event("OUTBOX_RETRY");
    }
  }
}
class ProcessingError extends Error {
  constructor(
    readonly code: string,
    readonly permanent = false,
  ) {
    super(code);
  }
}
export async function integrityStep(env: IngestionEnv, hash: string) {
  const row = await env.DB.prepare(
    "SELECT r2_key,size_bytes,mime_sha256 FROM messages WHERE id=? AND status!='deleted'",
  )
    .bind(hash)
    .first<{ r2_key: string; size_bytes: number; mime_sha256: string }>();
  if (!row) throw new ProcessingError("MESSAGE_MISSING", true);
  const object = await env.RAW_EMAILS.get(row.r2_key);
  if (!object) throw new ProcessingError("RAW_MISSING");
  // Fixed hard read cap: changing intake settings must not strand previously accepted mail.
  if (object.size > 10 * 1024 * 1024 || object.size !== row.size_bytes) {
    void object.body.cancel().catch(() => {});
    throw new ProcessingError("INTEGRITY_MISMATCH", true);
  }
  const bytes = await readBounded(object.body, 10 * 1024 * 1024);
  const digest = await sha256(bytes);
  if (digest !== row.mime_sha256 || bytes.length !== row.size_bytes)
    throw new ProcessingError("INTEGRITY_MISMATCH", true);
  return IntegrityOutcomeSchema.parse({
    version: 1,
    kind: "mime_integrity_verified",
    sizeBytes: bytes.length,
    sha256: digest,
  });
}
export async function processJob(
  env: IngestionEnv,
  id: string,
  now = Date.now(),
  step = integrityStep,
): Promise<"ack" | "retry"> {
  const token = crypto.randomUUID();
  const job = await env.DB.prepare(
    `UPDATE jobs SET state='processing',attempt_count=attempt_count+1,lease_token=?,lease_until=?,updated_at=?
    WHERE id=? AND stage='mime_integrity' AND version=1 AND state IN ('queued','failed') AND attempt_count<?
    AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND message_id IN (SELECT id FROM messages m WHERE status!='deleted'
      AND NOT EXISTS(SELECT 1 FROM deletion_tombstones t WHERE t.content_sha256=m.mime_sha256))
    RETURNING *`,
  )
    .bind(token, iso(now + LEASE_MS), iso(now), id, MAX_ATTEMPTS, iso(now))
    .first<Job>();
  if (!job) {
    const current = await env.DB.prepare("SELECT state FROM jobs WHERE id=?")
      .bind(id)
      .first<{ state: string }>();
    // Missing, succeeded, dead or explicitly deleted work is safe to discard; durable cron handles busy/delayed jobs.
    return current && !["succeeded", "dead"].includes(current.state)
      ? "retry"
      : "ack";
  }
  await env.DB.prepare(
    "UPDATE messages SET status='processing' WHERE id=? AND status!='deleted' AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND lease_token=?)",
  )
    .bind(job.message_id, id, token)
    .run();
  try {
    const outcome = await step(env, job.message_id);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE jobs SET state='succeeded',outcome_json=?,error_code=NULL,lease_until=NULL,lease_token=NULL,updated_at=?
        WHERE id=? AND lease_token=? AND state='processing' AND message_id IN (SELECT id FROM messages m WHERE status!='deleted'
        AND NOT EXISTS(SELECT 1 FROM deletion_tombstones t WHERE t.content_sha256=m.mime_sha256))`,
      ).bind(JSON.stringify(outcome), iso(now), id, token),
      env.DB.prepare(
        "UPDATE messages SET status='processed' WHERE id=? AND status!='deleted' AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='succeeded')",
      ).bind(job.message_id, id),
      env.DB.prepare(
        "UPDATE outbox SET sent_at=?,lease_token=NULL,lease_until=NULL WHERE job_id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='succeeded')",
      ).bind(iso(now), id, id),
    ]);
    event("JOB_SUCCEEDED");
    return "ack";
  } catch (error) {
    const code =
      error instanceof ProcessingError ? error.code : "PROCESSING_UNAVAILABLE";
    const dead =
      job.attempt_count >= MAX_ATTEMPTS ||
      (error instanceof ProcessingError && error.permanent);
    const next = iso(now + backoff(job.attempt_count) * 1000);
    // Every side effect is fenced to the still-owned job token in a single transaction.
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE outbox SET sent_at=NULL,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE job_id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND lease_token=? AND state='processing')",
      ).bind(next, id, id, token),
      env.DB.prepare(
        "UPDATE messages SET status='failed' WHERE id=? AND status!='deleted' AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND lease_token=? AND state='processing')",
      ).bind(job.message_id, id, token),
      env.DB.prepare(
        "UPDATE jobs SET state=?,next_attempt_at=?,error_code=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND state='processing'",
      ).bind(dead ? "dead" : "failed", next, code, iso(now), id, token),
    ]);
    event(dead ? "JOB_DEAD" : "JOB_RETRY");
    // The failure is durably rescheduled in D1; release this Queue delivery, cron publishes when due.
    return "ack";
  }
}
export async function consume(
  batch: MessageBatch<unknown>,
  env: IngestionEnv,
  now = Date.now(),
) {
  if (env.PROCESSING_ENABLED !== "true") {
    batch.retryAll({ delaySeconds: 300 });
    return;
  }
  // Sequential work bounds R2 buffering; config limits batches to 5.
  for (const message of batch.messages) {
    const payload = IngestionJobPayloadSchema.safeParse(message.body);
    if (!payload.success) {
      event("INVALID_QUEUE_PAYLOAD");
      message.ack();
      continue;
    }
    try {
      const result = await processJob(env, payload.data.jobId, now);
      if (result === "ack") message.ack();
      else message.retry({ delaySeconds: 60 });
    } catch {
      event("CONSUMER_UNAVAILABLE");
      message.retry({ delaySeconds: 60 });
    }
  }
}
