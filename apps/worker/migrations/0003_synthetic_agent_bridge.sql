-- Private bridge tables only. M2 receipt/job/outbox schema and public projection unchanged.
CREATE TABLE agent_fixtures (
 message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
 mime_sha256 TEXT NOT NULL UNIQUE,
 text_sha256 TEXT NOT NULL,
 synthetic INTEGER NOT NULL DEFAULT 1 CHECK(synthetic=1)
);
CREATE TABLE agent_batches (
 id TEXT PRIMARY KEY, principal TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 after_id TEXT, batch_limit INTEGER NOT NULL CHECK(batch_limit BETWEEN 1 AND 3),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','submitted'))
);
CREATE INDEX agent_batches_expiry ON agent_batches(expires_at);
CREATE TABLE agent_sessions (
 principal TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES agent_batches(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL
);
CREATE TABLE agent_claims (
 message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
 batch_id TEXT NOT NULL REFERENCES agent_batches(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','submitted','suppressed'))
);
CREATE INDEX agent_claims_batch ON agent_claims(batch_id);
CREATE TABLE agent_submissions (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL UNIQUE REFERENCES agent_batches(id) ON DELETE CASCADE,
 principal TEXT NOT NULL, request_sha256 TEXT NOT NULL,
 received_at TEXT NOT NULL, message_count INTEGER NOT NULL CHECK(message_count BETWEEN 1 AND 3)
);
CREATE TABLE agent_results (
 batch_id TEXT NOT NULL REFERENCES agent_batches(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 submission_id TEXT NOT NULL REFERENCES agent_submissions(id) ON DELETE CASCADE,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 state TEXT NOT NULL DEFAULT 'pending_validation' CHECK(state='pending_validation'),
 PRIMARY KEY(batch_id,message_id)
);
CREATE TABLE agent_rate_limits (
 principal TEXT NOT NULL, window_start TEXT NOT NULL,
 requests INTEGER NOT NULL CHECK(requests BETWEEN 1 AND 60),
 PRIMARY KEY(principal,window_start)
);
-- M2 deletion stays authoritative, including late external submissions.
CREATE TRIGGER agent_message_suppressed AFTER UPDATE OF status ON messages
 WHEN NEW.status='deleted'
 BEGIN
  DELETE FROM agent_results WHERE message_id=NEW.id;
  UPDATE agent_claims SET state='suppressed' WHERE message_id=NEW.id;
  DELETE FROM agent_fixtures WHERE message_id=NEW.id;
 END;
CREATE TRIGGER agent_hash_suppressed AFTER INSERT ON deletion_tombstones
 BEGIN
  DELETE FROM agent_results WHERE message_id IN (SELECT id FROM messages WHERE mime_sha256=NEW.content_sha256);
  UPDATE agent_claims SET state='suppressed' WHERE message_id IN (SELECT id FROM messages WHERE mime_sha256=NEW.content_sha256);
  DELETE FROM agent_fixtures WHERE mime_sha256=NEW.content_sha256;
 END;

CREATE TRIGGER agent_fixtures_immutable BEFORE UPDATE ON agent_fixtures
 BEGIN SELECT RAISE(ABORT,'Fixture enrollment is immutable'); END;
