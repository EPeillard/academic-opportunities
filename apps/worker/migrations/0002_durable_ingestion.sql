-- Append-only M2 additions; never rewrite the M1 schema or seed.
ALTER TABLE messages ADD COLUMN size_bytes INTEGER CHECK(size_bytes > 0);
ALTER TABLE messages ADD COLUMN message_id_hash TEXT;
ALTER TABLE messages ADD COLUMN message_id_kind TEXT CHECK(message_id_kind IN ('valid','missing','malformed'));
ALTER TABLE jobs ADD COLUMN lease_token TEXT;
ALTER TABLE jobs ADD COLUMN outcome_json TEXT CHECK(outcome_json IS NULL OR json_valid(outcome_json));
ALTER TABLE outbox ADD COLUMN next_attempt_at TEXT;
ALTER TABLE outbox ADD COLUMN lease_token TEXT;
ALTER TABLE outbox ADD COLUMN lease_until TEXT;
ALTER TABLE outbox ADD COLUMN error_code TEXT;
-- M1 has no active producers; keep the earliest row if a private installation
-- nevertheless inserted duplicate events before applying this migration.
DELETE FROM outbox WHERE rowid NOT IN (SELECT MIN(rowid) FROM outbox GROUP BY job_id);
CREATE UNIQUE INDEX outbox_job_unique ON outbox(job_id);
CREATE INDEX outbox_due ON outbox(next_attempt_at, lease_until);
CREATE INDEX messages_retention ON messages(status, delete_after);
CREATE INDEX messages_message_id ON messages(message_id_hash);
CREATE TABLE intake_admissions (
 content_sha256 TEXT PRIMARY KEY CHECK(length(content_sha256)=64),
 admitted_at TEXT NOT NULL
);
CREATE INDEX admissions_daily ON intake_admissions(admitted_at);
CREATE TABLE ingestion_maintenance (
 name TEXT PRIMARY KEY, value TEXT NOT NULL
);
-- Tombstones are deliberately never pruned by M2; expires_at is legacy metadata.
