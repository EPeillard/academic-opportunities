import {
  IntakeError,
  iso,
  jobId,
  limits,
  type IngestionEnv,
  type Receipt,
} from "./types";
export async function suppressed(env: IngestionEnv, hash: string) {
  return !!(await env.DB.prepare(
    "SELECT 1 FROM deletion_tombstones WHERE content_sha256=? UNION ALL SELECT 1 FROM messages WHERE mime_sha256=? AND status='deleted' LIMIT 1",
  )
    .bind(hash, hash)
    .first());
}
export async function admit(env: IngestionEnv, hash: string, now: number) {
  const cap = limits(env).daily;
  // INSERT SELECT and quota test are one serialized SQL statement. Replays use the existing intent.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO intake_admissions(content_sha256,admitted_at)
    SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM deletion_tombstones WHERE content_sha256=?)
    AND (SELECT COUNT(*) FROM intake_admissions WHERE admitted_at>=?) < ?`,
  )
    .bind(hash, iso(now), hash, iso(now).slice(0, 10), cap)
    .run();
  if (await suppressed(env, hash)) throw new IntakeError("DELETED");
  if (
    !(await env.DB.prepare(
      "SELECT 1 FROM intake_admissions WHERE content_sha256=?",
    )
      .bind(hash)
      .first())
  )
    throw new IntakeError("DAILY_LIMIT");
}
export async function register(env: IngestionEnv, r: Receipt) {
  const id = jobId(r.hash);
  const deleteAfter = iso(
    Date.parse(r.receivedAt) + limits(env).retentionDays * 86400000,
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO messages(id,mime_sha256,r2_key,received_at,delete_after,status,size_bytes,message_id_hash,message_id_kind)
      SELECT ?,?,?,?,?,'stored',?,?,? WHERE NOT EXISTS(SELECT 1 FROM deletion_tombstones WHERE content_sha256=?)`,
    ).bind(
      r.hash,
      r.hash,
      r.key,
      r.receivedAt,
      deleteAfter,
      r.size,
      r.messageIdHash,
      r.messageIdKind,
      r.hash,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO jobs(id,message_id,stage,version,state,created_at,updated_at,next_attempt_at)
      SELECT ?,id,'mime_integrity',1,'queued',?,?,? FROM messages WHERE id=? AND status!='deleted'
      AND NOT EXISTS(SELECT 1 FROM deletion_tombstones WHERE content_sha256=?)`,
    ).bind(id, r.receivedAt, r.receivedAt, r.receivedAt, r.hash, r.hash),
    env.DB.prepare(
      `INSERT OR IGNORE INTO outbox(id,job_id,created_at,next_attempt_at)
      SELECT id,id,?,? FROM jobs WHERE id=? AND state NOT IN ('dead','succeeded')`,
    ).bind(r.receivedAt, r.receivedAt, id),
  ]);
  if (await suppressed(env, r.hash)) throw new IntakeError("DELETED");
  if (
    !(await env.DB.prepare(
      "SELECT 1 FROM messages m JOIN jobs j ON j.message_id=m.id JOIN outbox o ON o.job_id=j.id WHERE m.id=? AND j.id=?",
    )
      .bind(r.hash, id)
      .first())
  )
    throw new Error("DURABLE_REGISTRATION_FAILED");
}
// Private function only, no HTTP route. Tombstone transaction commits before any R2 deletion.
export async function deleteMessage(
  env: IngestionEnv,
  hash: string,
  now = Date.now(),
) {
  const { hashPattern, objectKey } = await import("./types");
  if (!hashPattern.test(hash)) throw new Error("INVALID_HASH");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO deletion_tombstones(content_sha256,deleted_at,expires_at) VALUES (?,?,?)",
    ).bind(hash, iso(now), "9999-12-31T23:59:59.999Z"),
    env.DB.prepare(
      "UPDATE messages SET status='deleted',message_id_hash=NULL,message_id_kind=NULL WHERE mime_sha256=?",
    ).bind(hash),
    env.DB.prepare(
      "UPDATE jobs SET state='dead',lease_token=NULL,lease_until=NULL,outcome_json=NULL,error_code='DELETED',updated_at=? WHERE message_id=?",
    ).bind(iso(now), hash),
    env.DB.prepare(
      "DELETE FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE message_id=?)",
    ).bind(hash),
    env.DB.prepare("DELETE FROM intake_admissions WHERE content_sha256=?").bind(
      hash,
    ),
  ]);
  await env.RAW_EMAILS.delete(objectKey(hash));
}
