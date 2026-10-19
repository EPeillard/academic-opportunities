-- Public metadata is an approved projection. Private evidence and MIME references
-- are intentionally separate; only published projections are read by the API.
CREATE TABLE opportunities (
 id TEXT PRIMARY KEY,
 state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','pending_review','published','rejected','archived')),
 title TEXT, job_type TEXT CHECK (job_type IN ('Internship','PhD','Postdoc','Research Engineer','Research Scientist','Faculty','Other')),
 organization TEXT, laboratory TEXT, country TEXT, city TEXT,
 duration TEXT, compensation TEXT, start_date TEXT, application_deadline TEXT,
 contact TEXT, application_url TEXT, description TEXT,
 publication_format TEXT NOT NULL DEFAULT 'summary' CHECK (publication_format IN ('summary','authorized_full_text')),
 published_at TEXT, updated_at TEXT NOT NULL,
 synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0,1)),
 revision_number INTEGER NOT NULL DEFAULT 1 CHECK(revision_number > 0),
 CHECK (state != 'published' OR (title IS NOT NULL AND job_type IS NOT NULL AND description IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX opportunities_publication ON opportunities(state,published_at DESC,id);
CREATE INDEX opportunities_filters ON opportunities(state,job_type,country,application_deadline);
CREATE TABLE opportunity_topics (
 opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
 topic TEXT NOT NULL,
 PRIMARY KEY(opportunity_id,topic)
);
CREATE INDEX topics_lookup ON opportunity_topics(topic,opportunity_id);
CREATE TABLE public_sources (
 id TEXT PRIMARY KEY,
 opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
 label TEXT NOT NULL, public_url TEXT, received_at TEXT NOT NULL
);
CREATE INDEX sources_opportunity ON public_sources(opportunity_id);

-- Future pipeline schema: no handler writes these tables in M1.
CREATE TABLE messages (
 id TEXT PRIMARY KEY, mime_sha256 TEXT NOT NULL UNIQUE,
 r2_key TEXT NOT NULL UNIQUE, received_at TEXT NOT NULL, delete_after TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('stored','processing','processed','failed','deleted'))
);
CREATE TABLE attachments (
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 r2_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),delete_after TEXT NOT NULL
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 stage TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN ('queued','processing','succeeded','failed','dead')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),next_attempt_at TEXT,
 lease_until TEXT,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(message_id,stage,version)
);
CREATE INDEX jobs_recovery ON jobs(state,next_attempt_at,lease_until);
CREATE TABLE outbox (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unsent ON outbox(sent_at);
CREATE TABLE opportunity_messages (
 opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 PRIMARY KEY(opportunity_id,message_id)
);
CREATE TABLE revisions (
 id TEXT PRIMARY KEY,opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
 revision_number INTEGER NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 created_at TEXT NOT NULL,UNIQUE(opportunity_id,revision_number)
);
CREATE TABLE field_evidence (
 id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 field TEXT NOT NULL,quote TEXT NOT NULL,span_start INTEGER NOT NULL,span_end INTEGER NOT NULL,
 CHECK(span_start>=0 AND span_end>span_start)
);
CREATE TABLE permission_policies (
 id TEXT PRIMARY KEY,source_key TEXT NOT NULL,authorization_basis TEXT NOT NULL,
 scope TEXT NOT NULL,valid_until TEXT,reviewed_at TEXT NOT NULL
);
CREATE TABLE publication_checks (
 id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('relevance','extraction','permission','privacy','security','deduplication')),
 result TEXT NOT NULL CHECK(result IN ('pass','review','fail')),
 policy_id TEXT REFERENCES permission_policies(id),reason_code TEXT NOT NULL,
 details_json TEXT NOT NULL CHECK(json_valid(details_json)),created_at TEXT NOT NULL
);
CREATE TABLE deduplication_decisions (
 id TEXT PRIMARY KEY,opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
 candidate_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
 method TEXT NOT NULL CHECK(method IN ('hash','canonical_url','fingerprint','semantic','manual')),
 score REAL CHECK(score BETWEEN 0 AND 1),decision TEXT NOT NULL CHECK(decision IN ('same','different','review')),
 created_at TEXT NOT NULL
);
CREATE TABLE audit_events (
 id TEXT PRIMARY KEY,opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
 actor_id TEXT NOT NULL,action TEXT NOT NULL,reason_code TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE deletion_tombstones (
 content_sha256 TEXT PRIMARY KEY,deleted_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
