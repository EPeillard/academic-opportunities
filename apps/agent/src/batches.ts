import manifest from "./fixtures.json";
import {
  BatchQuerySchema,
  BatchResponseSchema,
  ReceiptSchema,
  SubmissionSchema,
  type Submission,
} from "./contracts";
import {
  ApiError,
  BATCH_TTL_MS,
  digest,
  iso,
  READ_SCOPE,
  requireScope,
  WRITE_SCOPE,
  type AgentEnv,
  type Principal,
} from "./common";
export const fixtures = manifest;
// Both immutable MIME identity and curated text digest must match the compiled allowlist.
const eligibility = `m.status='processed' AND m.id=m.mime_sha256 AND m.mime_sha256=f.mime_sha256 AND f.synthetic=1
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.message_id=m.id AND j.stage='mime_integrity' AND j.version=1 AND j.state='succeeded')
 AND NOT EXISTS(SELECT 1 FROM deletion_tombstones t WHERE t.content_sha256=m.mime_sha256)`;
function knownFixture(id: string, textHash: string) {
  return fixtures.find((f) => f.messageId === id && f.textSha256 === textHash);
}
export async function rateLimit(
  env: AgentEnv,
  principal: Principal,
  now: number,
) {
  const window = iso(now).slice(0, 13);
  const accepted = await env.DB.prepare(
    `INSERT INTO agent_rate_limits(principal,window_start,requests) VALUES (?,?,1)
    ON CONFLICT(principal,window_start) DO UPDATE SET requests=requests+1 WHERE requests<60 RETURNING requests`,
  )
    .bind(principal.id, window)
    .first();
  if (!accepted) throw new ApiError(429, "RATE_LIMITED");
  // Bound cleanup; malformed/unauthenticated requests never touch D1.
  await env.DB.prepare(
    "DELETE FROM agent_rate_limits WHERE rowid IN (SELECT rowid FROM agent_rate_limits WHERE window_start<? LIMIT 10)",
  )
    .bind(iso(now - 48 * 3600000).slice(0, 13))
    .run();
}
interface Batch {
  id: string;
  principal: string;
  expires_at: string;
  after_id: string | null;
  batch_limit: number;
  state: string;
}
async function items(env: AgentEnv, batchId: string) {
  return (
    await env.DB.prepare(
      `SELECT c.message_id,c.state,f.text_sha256,CASE WHEN ${eligibility} THEN 1 ELSE 0 END AS eligible
    FROM agent_claims c JOIN messages m ON m.id=c.message_id LEFT JOIN agent_fixtures f ON f.message_id=m.id WHERE c.batch_id=? ORDER BY c.message_id`,
    )
      .bind(batchId)
      .all<{
        message_id: string;
        state: string;
        text_sha256: string;
        eligible: number;
      }>()
  ).results;
}
export async function pendingBatch(
  env: AgentEnv,
  principal: Principal,
  input: unknown,
  now: number,
) {
  requireScope(principal, READ_SCOPE);
  const parsed = BatchQuerySchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_QUERY");
  const q = parsed.data;
  let active = await env.DB.prepare(
    "SELECT b.* FROM agent_sessions s JOIN agent_batches b ON b.id=s.batch_id WHERE s.principal=? AND s.expires_at>? AND b.state='open'",
  )
    .bind(principal.id, iso(now))
    .first<Batch>();
  if (
    active &&
    (active.after_id !== (q.cursor ?? null) || active.batch_limit !== q.limit)
  )
    throw new ApiError(409, "ACTIVE_BATCH_PARAMETERS_DIFFER");
  if (!active) {
    const candidates = (
      await env.DB.prepare(
        `SELECT m.id,f.text_sha256 FROM messages m JOIN agent_fixtures f ON f.message_id=m.id
      LEFT JOIN agent_claims c ON c.message_id=m.id WHERE ${eligibility}
      AND m.id IN (?,?,?) AND m.id>? AND (c.message_id IS NULL OR (c.state='pending' AND c.expires_at<=?)) ORDER BY m.id LIMIT 3`,
      )
        .bind(...fixtures.map((f) => f.messageId), q.cursor ?? "", iso(now))
        .all<{ id: string; text_sha256: string }>()
    ).results
      .filter((r) => knownFixture(r.id, r.text_sha256))
      .slice(0, q.limit);
    if (!candidates.length)
      return BatchResponseSchema.parse({
        schemaVersion: 1,
        batchId: null,
        expiresAt: null,
        nextCursor: null,
        messages: [],
      });
    const id = crypto.randomUUID(),
      expires = iso(now + BATCH_TTL_MS);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO agent_batches(id,principal,created_at,expires_at,after_id,batch_limit) VALUES (?,?,?,?,?,?)",
      ).bind(id, principal.id, iso(now), expires, q.cursor ?? null, q.limit),
      env.DB.prepare(
        `INSERT INTO agent_sessions(principal,batch_id,expires_at) VALUES (?,?,?)
        ON CONFLICT(principal) DO UPDATE SET batch_id=excluded.batch_id,expires_at=excluded.expires_at
        WHERE agent_sessions.expires_at<=? OR EXISTS(SELECT 1 FROM agent_batches WHERE id=agent_sessions.batch_id AND state='submitted')`,
      ).bind(principal.id, id, expires, iso(now)),
      ...candidates.map((row) =>
        env.DB.prepare(
          `INSERT INTO agent_claims(message_id,batch_id,expires_at)
        SELECT m.id,?,? FROM messages m JOIN agent_fixtures f ON f.message_id=m.id WHERE m.id=? AND f.text_sha256=? AND ${eligibility}
        AND EXISTS(SELECT 1 FROM agent_sessions WHERE principal=? AND batch_id=?)
        ON CONFLICT(message_id) DO UPDATE SET batch_id=excluded.batch_id,expires_at=excluded.expires_at
        WHERE agent_claims.state='pending' AND agent_claims.expires_at<=?`,
        ).bind(
          id,
          expires,
          row.id,
          row.text_sha256,
          principal.id,
          id,
          iso(now),
        ),
      ),
    ]);
    active = await env.DB.prepare(
      "SELECT b.* FROM agent_sessions s JOIN agent_batches b ON b.id=s.batch_id WHERE s.principal=?",
    )
      .bind(principal.id)
      .first<Batch>();
    if (
      !active ||
      active.after_id !== (q.cursor ?? null) ||
      active.batch_limit !== q.limit
    )
      throw new ApiError(409, "BATCH_ALLOCATION_CONFLICT");
  }
  const rows = await items(env, active.id);
  if (!rows.length) {
    await env.DB.prepare(
      "DELETE FROM agent_sessions WHERE principal=? AND batch_id=?",
    )
      .bind(principal.id, active.id)
      .run();
    return BatchResponseSchema.parse({
      schemaVersion: 1,
      batchId: null,
      expiresAt: null,
      nextCursor: null,
      messages: [],
    });
  }
  if (
    rows.some(
      (r) =>
        r.state !== "pending" ||
        !r.eligible ||
        !knownFixture(r.message_id, r.text_sha256),
    )
  )
    throw new ApiError(410, "BATCH_UNAVAILABLE");
  return BatchResponseSchema.parse({
    schemaVersion: 1,
    batchId: active.id,
    expiresAt: active.expires_at,
    nextCursor: rows.at(-1)!.message_id,
    messages: rows.map((r) => ({
      messageId: r.message_id,
      synthetic: true,
      contentType: "text/plain",
      textSha256: r.text_sha256,
      untrustedText: knownFixture(r.message_id, r.text_sha256)!.untrustedText,
    })),
  });
}
function evidenceValid(result: Submission["results"][number]) {
  const fixture = fixtures.find((f) => f.messageId === result.messageId);
  if (!fixture) return false;
  for (const candidate of result.candidates) {
    for (const evidence of candidate.evidence)
      if (
        evidence.messageId !== result.messageId ||
        fixture.untrustedText.slice(evidence.start, evidence.end) !==
          evidence.quote
      )
        return false;
    for (const [field, value] of Object.entries(candidate.fields)) {
      const populated = Array.isArray(value)
        ? value.length > 0
        : value !== null;
      if (populated && !candidate.evidence.some((e) => e.field === field))
        return false;
    }
  }
  return true;
}
const receipt = (s: {
  id: string;
  batch_id: string;
  received_at: string;
  message_count: number;
}) =>
  ReceiptSchema.parse({
    submissionId: s.id,
    batchId: s.batch_id,
    receivedAt: s.received_at,
    messageCount: s.message_count,
    state: "pending_validation",
  });
interface StoredSubmission {
  id: string;
  batch_id: string;
  principal: string;
  request_sha256: string;
  received_at: string;
  message_count: number;
}
export async function submitResults(
  env: AgentEnv,
  principal: Principal,
  input: unknown,
  now: number,
) {
  requireScope(principal, WRITE_SCOPE);
  const parsed = SubmissionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_SUBMISSION");
  const body = parsed.data;
  if (
    new Set(body.results.map((r) => r.messageId)).size !==
      body.results.length ||
    !body.results.every(evidenceValid)
  )
    throw new ApiError(400, "INVALID_EVIDENCE_OR_MEMBERSHIP");
  body.results.sort((a, b) => a.messageId.localeCompare(b.messageId));
  const hash = await digest(
    JSON.stringify({
      schemaVersion: body.schemaVersion,
      batchId: body.batchId,
      results: body.results,
    }),
  );
  const batch = await env.DB.prepare(
    "SELECT * FROM agent_batches WHERE id=? AND principal=?",
  )
    .bind(body.batchId, principal.id)
    .first<Batch>();
  if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND");
  if (batch.state === "open" && batch.expires_at <= iso(now))
    throw new ApiError(410, "BATCH_EXPIRED");
  const rows = await items(env, batch.id);
  if (
    rows.some(
      (r) =>
        !r.eligible ||
        r.state === "suppressed" ||
        !knownFixture(r.message_id, r.text_sha256),
    )
  )
    throw new ApiError(410, "BATCH_UNAVAILABLE");
  if (
    rows.length !== body.results.length ||
    rows.some((r, i) => r.message_id !== body.results[i].messageId)
  )
    throw new ApiError(400, "BATCH_MEMBERSHIP_MISMATCH");
  const existing = await env.DB.prepare(
    "SELECT * FROM agent_submissions WHERE id=? OR batch_id=? LIMIT 1",
  )
    .bind(body.submissionId, body.batchId)
    .first<StoredSubmission>();
  if (existing) {
    if (
      existing.id !== body.submissionId ||
      existing.batch_id !== body.batchId ||
      existing.principal !== principal.id ||
      existing.request_sha256 !== hash
    )
      throw new ApiError(409, "SUBMISSION_CONFLICT");
    return receipt(existing);
  }
  if (batch.expires_at <= iso(now) || rows.some((r) => r.state !== "pending"))
    throw new ApiError(410, "BATCH_EXPIRED");
  // The INSERT guard repeats authorization, expiry, M2 integrity and suppression
  // checks inside the transaction, not just in the advisory reads above.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO agent_submissions(id,batch_id,principal,request_sha256,received_at,message_count)
      SELECT ?,b.id,b.principal,?,?,? FROM agent_batches b WHERE b.id=? AND b.principal=? AND b.state='open' AND b.expires_at>?
      AND (SELECT COUNT(*) FROM agent_claims c WHERE c.batch_id=b.id)=?
      AND NOT EXISTS(SELECT 1 FROM agent_claims c JOIN messages m ON m.id=c.message_id LEFT JOIN agent_fixtures f ON f.message_id=m.id
        WHERE c.batch_id=b.id AND (c.state!='pending' OR c.expires_at<=? OR COALESCE((${eligibility}),0)=0))`,
    ).bind(
      body.submissionId,
      hash,
      iso(now),
      rows.length,
      batch.id,
      principal.id,
      iso(now),
      rows.length,
      iso(now),
    ),
    ...body.results.map((r) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO agent_results(batch_id,message_id,submission_id,payload_json)
      SELECT s.batch_id,?,s.id,? FROM agent_submissions s WHERE s.id=? AND s.batch_id=? AND s.principal=? AND s.request_sha256=?`,
      ).bind(
        r.messageId,
        JSON.stringify(r),
        body.submissionId,
        batch.id,
        principal.id,
        hash,
      ),
    ),
    env.DB.prepare(
      `UPDATE agent_claims SET state='submitted' WHERE batch_id=? AND EXISTS(SELECT 1 FROM agent_submissions WHERE id=? AND batch_id=? AND principal=? AND request_sha256=?)`,
    ).bind(batch.id, body.submissionId, batch.id, principal.id, hash),
    env.DB.prepare(
      `UPDATE agent_batches SET state='submitted' WHERE id=? AND EXISTS(SELECT 1 FROM agent_submissions WHERE id=? AND batch_id=? AND principal=? AND request_sha256=?)`,
    ).bind(batch.id, body.submissionId, batch.id, principal.id, hash),
  ]);
  const saved = await env.DB.prepare(
    "SELECT * FROM agent_submissions WHERE id=? AND batch_id=? AND principal=? AND request_sha256=?",
  )
    .bind(body.submissionId, batch.id, principal.id, hash)
    .first<StoredSubmission>();
  if (!saved) throw new ApiError(409, "SUBMISSION_COMMIT_CONFLICT");
  return receipt(saved);
}
