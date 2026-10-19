import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export const fixtureManifest = JSON.parse(
  readFileSync(
    new URL("../apps/agent/src/fixtures.json", import.meta.url),
    "utf8",
  ),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export function fixtureSql(
  now = new Date(),
  read = (path) => readFileSync(path),
) {
  if (fixtureManifest.length !== 3)
    throw new Error("Unexpected synthetic manifest");
  const date = now.toISOString(),
    expiry = new Date(now.getTime() + 7 * 86400000).toISOString();
  const sql = [
    "CREATE TABLE IF NOT EXISTS _agent_poc_init_guard (ok INTEGER CHECK(ok=1));",
    "DELETE FROM _agent_poc_init_guard;",
  ];
  // Executed in one D1 SQL-file transaction. Abort before any fixture insert on contamination.
  const checks = [
    "NOT EXISTS(SELECT 1 FROM opportunities)",
    "NOT EXISTS(SELECT 1 FROM jobs)",
    "NOT EXISTS(SELECT 1 FROM outbox)",
    "NOT EXISTS(SELECT 1 FROM attachments)",
    "NOT EXISTS(SELECT 1 FROM deletion_tombstones)",
    `NOT EXISTS(SELECT 1 FROM messages WHERE id NOT IN (${fixtureManifest.map((f) => quote(f.messageId)).join(",")}))`,
  ];
  for (const f of fixtureManifest) {
    const mime = read(
      new URL(`../tests/fixtures/agent/${f.name}.eml`, import.meta.url),
    );
    if (sha(mime) !== f.messageId || sha(f.untrustedText) !== f.textSha256)
      throw new Error("Synthetic fixture hash mismatch");
    const id = quote(f.messageId),
      key = quote(`synthetic-no-object/${f.messageId}`);
    checks.push(
      `NOT EXISTS(SELECT 1 FROM messages WHERE id=${id} AND (mime_sha256!=${id} OR r2_key!=${key} OR status!='processed' OR size_bytes IS NOT ${mime.byteLength}))`,
    );
    checks.push(
      `NOT EXISTS(SELECT 1 FROM agent_fixtures WHERE message_id=${id} AND (mime_sha256!=${id} OR text_sha256!=${quote(f.textSha256)} OR synthetic!=1))`,
    );
  }
  sql.push(
    `INSERT INTO _agent_poc_init_guard VALUES(CASE WHEN ${checks.join(" AND ")} THEN 1 ELSE 0 END);`,
  );
  for (const f of fixtureManifest) {
    const id = quote(f.messageId),
      mime = read(
        new URL(`../tests/fixtures/agent/${f.name}.eml`, import.meta.url),
      );
    sql.push(
      `INSERT OR IGNORE INTO messages(id,mime_sha256,r2_key,received_at,delete_after,status,size_bytes) VALUES(${id},${id},${quote(`synthetic-no-object/${f.messageId}`)},${quote(date)},${quote(expiry)},'processed',${mime.byteLength});`,
    );
    sql.push(
      `INSERT OR IGNORE INTO agent_fixtures(message_id,mime_sha256,text_sha256) VALUES(${id},${id},${quote(f.textSha256)});`,
    );
    sql.push(
      `INSERT OR IGNORE INTO agent_fixture_bootstraps(message_id,fixture_version,initialized_at) VALUES(${id},1,${quote(date)});`,
    );
  }
  sql.push("DROP TABLE _agent_poc_init_guard;");
  return sql.join("\n") + "\n";
}
