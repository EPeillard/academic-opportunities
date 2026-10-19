-- Explicit synthetic-only bootstrap provenance. Never represents an M2 R2 receipt.
CREATE TABLE agent_fixture_bootstraps (
 message_id TEXT PRIMARY KEY REFERENCES agent_fixtures(message_id) ON DELETE CASCADE,
 fixture_version INTEGER NOT NULL CHECK(fixture_version=1),
 initialized_at TEXT NOT NULL
);
CREATE TRIGGER agent_bootstrap_immutable BEFORE UPDATE ON agent_fixture_bootstraps
 BEGIN SELECT RAISE(ABORT,'Synthetic bootstrap provenance is immutable'); END;
