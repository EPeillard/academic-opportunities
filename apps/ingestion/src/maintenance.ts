import { readBounded, inspectHeaders, sha256 } from "./mime";
import { deleteMessage, register, suppressed } from "./storage";
import { dispatchOutbox } from "./processing";
import {
  event,
  backoff,
  hashPattern,
  iso,
  MAX_ATTEMPTS,
  objectKey,
  ORPHAN_GRACE_MS,
  PAGE_SIZE,
  PREFIX,
  limits,
  type IngestionEnv,
} from "./types";
async function recoverInventory(env: IngestionEnv, now: number) {
  const cursor = await env.DB.prepare(
    "SELECT value FROM ingestion_maintenance WHERE name='r2_cursor'",
  ).first<{ value: string }>();
  const page = await env.RAW_EMAILS.list({
    prefix: PREFIX,
    limit: PAGE_SIZE,
    ...(cursor?.value ? { cursor: cursor.value } : {}),
  });
  for (const object of page.objects) {
    try {
      const hash = object.key.slice(PREFIX.length, -4);
      if (!hashPattern.test(hash) || object.key !== objectKey(hash)) continue;
      if (await suppressed(env, hash)) {
        await env.RAW_EMAILS.delete(object.key);
        continue;
      }
      if (
        await env.DB.prepare("SELECT 1 FROM messages WHERE id=?")
          .bind(hash)
          .first()
      )
        continue;
      if (object.uploaded.getTime() > now - ORPHAN_GRACE_MS) continue;
      const intent = await env.DB.prepare(
        "SELECT admitted_at FROM intake_admissions WHERE content_sha256=?",
      )
        .bind(hash)
        .first<{ admitted_at: string }>();
      if (!intent) {
        await env.RAW_EMAILS.delete(object.key);
        event("UNKNOWN_ORPHAN_PURGED");
        continue;
      }
      if (
        object.uploaded.getTime() + limits(env).retentionDays * 86400000 <=
        now
      ) {
        await deleteMessage(env, hash, now);
        continue;
      }
      const raw = await env.RAW_EMAILS.get(object.key);
      if (!raw) continue;
      if (raw.size > 10 * 1024 * 1024) {
        void raw.body.cancel().catch(() => {});
        event("ORPHAN_INVALID");
        continue;
      }
      const bytes = await readBounded(raw.body, 10 * 1024 * 1024);
      if ((await sha256(bytes)) !== hash) {
        event("ORPHAN_INVALID");
        continue;
      }
      const metadata = await inspectHeaders(bytes);
      await register(env, {
        hash,
        key: object.key,
        size: bytes.length,
        // Admission can predate successful storage by days after an outage.
        // Retention starts at the immutable object's receipt, never the budget intent.
        receivedAt: iso(object.uploaded.getTime()),
        ...metadata,
      });
      event("ORPHAN_RECOVERED");
    } catch {
      event("ORPHAN_RECOVERY_DEFERRED");
    }
  }
  // Per-object failures retry on the next sweep; a crash before the cursor commit replays this page.
  await env.DB.prepare(
    "INSERT INTO ingestion_maintenance(name,value) VALUES ('r2_cursor',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
  )
    .bind(page.truncated ? page.cursor : "")
    .run();
}
export async function reconcile(
  env: IngestionEnv,
  now = Date.now(),
  phase?: number,
) {
  if (env.PROCESSING_ENABLED !== "true") return;
  if (phase === undefined || phase === 0) {
    const dueDelete = await env.DB.prepare(
      "SELECT mime_sha256 FROM messages WHERE status!='deleted' AND delete_after<=? ORDER BY delete_after,id LIMIT ?",
    )
      .bind(iso(now), PAGE_SIZE)
      .all<{ mime_sha256: string }>();
    // Deleted rows are not endlessly preferred over live due rows. Purge retries
    // for old tombstoned objects also happen in the paginated R2 scan.
    for (const row of dueDelete.results) {
      await deleteMessage(env, row.mime_sha256, now);
    }
  }
  if (phase === undefined || phase === 1) {
    const expired = await env.DB.prepare(
      "SELECT id,attempt_count FROM jobs WHERE stage='mime_integrity' AND version=1 AND state='processing' AND lease_until<=? ORDER BY lease_until,id LIMIT ?",
    )
      .bind(iso(now), PAGE_SIZE)
      .all<{ id: string; attempt_count: number }>();
    for (const row of expired.results) {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE messages SET status='failed' WHERE status!='deleted' AND id IN (SELECT message_id FROM jobs WHERE id=? AND state='processing' AND lease_until<=?)",
        ).bind(row.id, iso(now)),
        env.DB.prepare(
          "UPDATE jobs SET state=CASE WHEN attempt_count>=? THEN 'dead' ELSE 'failed' END,error_code='LEASE_EXPIRED',lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND state='processing' AND lease_until<=?",
        ).bind(
          MAX_ATTEMPTS,
          iso(now + backoff(row.attempt_count) * 1000),
          iso(now),
          row.id,
          iso(now),
        ),
      ]);
    }
  }
  if (phase === undefined || phase === 2) {
    const due = await env.DB.prepare(
      `SELECT j.id,j.message_id FROM jobs j JOIN messages m ON m.id=j.message_id
    WHERE j.stage='mime_integrity' AND j.version=1 AND j.state IN ('queued','failed') AND j.attempt_count<? AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=?)
    AND m.status!='deleted' AND NOT EXISTS(SELECT 1 FROM deletion_tombstones t WHERE t.content_sha256=m.mime_sha256)
    AND (NOT EXISTS(SELECT 1 FROM outbox o WHERE o.job_id=j.id) OR EXISTS(SELECT 1 FROM outbox o WHERE o.job_id=j.id AND o.sent_at IS NOT NULL AND o.next_attempt_at<=?))
    ORDER BY j.updated_at,j.id LIMIT ?`,
    )
      .bind(MAX_ATTEMPTS, iso(now), iso(now), PAGE_SIZE)
      .all<{ id: string; message_id: string }>();
    for (const row of due.results) {
      await env.DB.prepare(
        `INSERT INTO outbox(id,job_id,created_at,next_attempt_at) VALUES (?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET sent_at=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=excluded.next_attempt_at
      WHERE outbox.sent_at IS NOT NULL AND outbox.next_attempt_at<=?`,
      )
        .bind(row.id, row.id, iso(now), iso(now), iso(now))
        .run();
    }
  }
  if (phase === undefined || phase === 3) await recoverInventory(env, now);
  if (phase === undefined || phase === 4) await dispatchOutbox(env, now);
  event("RECONCILIATION_COMPLETE");
}

// One phase per scheduled invocation keeps worst-case binding/query counts bounded.
// Persist phase advancement only after success; all phases are replay-safe.
export async function maintenanceTick(env: IngestionEnv, now = Date.now()) {
  if (env.PROCESSING_ENABLED !== "true") return;
  const row = await env.DB.prepare(
    "SELECT value FROM ingestion_maintenance WHERE name='phase'",
  ).first<{ value: string }>();
  const phase = Number(row?.value ?? "0");
  if (!Number.isInteger(phase) || phase < 0 || phase > 4)
    throw new Error("INVALID_MAINTENANCE_PHASE");
  await reconcile(env, now, phase);
  await env.DB.prepare(
    "INSERT INTO ingestion_maintenance(name,value) VALUES ('phase',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
  )
    .bind(String((phase + 1) % 5))
    .run();
}
