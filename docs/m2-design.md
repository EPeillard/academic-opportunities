# M2 durable intake design and decisions

Design written before implementation, 2026-10-19. Scope: private receipt and deterministic integrity verification only. No MIME rendering/parsing of attachments, extraction, opportunity writes or automatic publication. The deployed demo is unchanged.

## Receipt protocol

Validate configuration, bounded RFC-style header block and actual stream size; compute SHA-256 of exact MIME bytes. Message-ID is optional untrusted metadata, stored as a hash with valid/missing/malformed classification. It is never a unique delivery identity. Gmail forwards with changed bytes remain distinct receipts for M3 announcement-level deduplication.

D1 first reserves a minimal hash-only admission with an atomic daily admission cap. This avoids unlimited R2 writes after the budget is exhausted. It is an intent, not successful ingestion. Next store the immutable MIME object in private R2, then atomically insert message + versioned integrity job + outbox in D1. Successful email handler return requires R2 and all three D1 records. Queue dispatch is independent: failure after commit does not reject already durable email. Failures before commit return a fixed rejection and retain recoverable intent/object; permanent SMTP rejection does not guarantee sender retry, so operational alerts matter.

Use stable content-addressed IDs/keys, R2 conditional create and D1 unique constraints. Duplicate byte-identical deliveries do not overwrite/delete a live object or reset a job. Content-hash suppression tombstones take precedence at admission, registration, processing and reconciliation. D1 transactions cannot include R2/Queue; all cross-service gaps are repaired rather than presented as atomic.

## Work and fencing

One outbox row per job. Conditional tokenized dispatch leases permit duplicate publication after a crash; only job IDs enter Queue. D1 processing leases and token-fenced completion prevent duplicate commits and stale workers overwriting newer work. Durable attempt counts (not Queue attempts) cap retries. Exponential delay and a fixed maximum backoff bound retries. Dead jobs require an explicit private operator decision; maintenance never resets them. The placeholder reads bounded R2 bytes, checks hash/length and stores a fixed versioned integrity outcome without interpreting email instructions or fetching links.

Periodic reconciliation resets expired leases, recreates/re-arms missing outboxes for due unfinished jobs, and reissues unconsumed queued work after a watchdog interval. Queue retention is not a durability boundary. A paginated R2 inventory with a persisted cursor recovers admitted orphan objects after a grace period, purges tombstoned objects, and deletes aged unknown objects in the dedicated prefix. It must never scan/delete arbitrary bucket prefixes. Retention deletion writes a permanent hash tombstone before deleting MIME; failed R2 deletes are retried. No expiry of tombstones is implemented, so explicitly deleted exact bytes cannot be reimported.

## Limits and rollout

Bounded message bytes/header bytes/chunks/read duration; atomic per-day unique-content admission cap; bounded maintenance pages and Queue batches/concurrency; at most eight processing attempts. Repeated byte-identical deliveries still consume Worker/DB operations; provider edge abuse controls and quotas remain necessary. MIME stays opaque, including attachments and nested forwards. No public ingestion/debug/deletion endpoints.

Local configuration may attach a local Queue consumer and cron. Generated production config has runtime gates off and no consumer or schedule. A separate offline activation preparation command requires an explicit flag to add the consumer/cron, and must not call Cloudflare. Deployment and Email Routing attachment remain separate manually approved operations. Base production/public/demo generation remains unchanged except ingestion safety vars.

## Official references reviewed

- [Email Worker API](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/): raw stream, rawSize, headers and setReject; rejection is permanent SMTP failure.
- [Local email testing](https://developers.cloudflare.com/email-service/observability/local-development/routing/): Wrangler localhost email simulation.
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/): transactional statement batches.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): conditional put, get, list cursors and private bindings.
- [Queues API](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [retries](https://developers.cloudflare.com/queues/configuration/batching-retries/) and [concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/): explicit per-message acknowledgment/retry; duplicate execution must be expected.

Trade-offs: bounded buffering rather than incremental hash dependencies; exact-byte idempotency rather than semantic merging; permanent minimal hash suppression rather than deletion expiry; fixed integrity-only job rather than premature MIME/LLM processing. D1 availability is required for admission. R2 retention is 30 days from first receipt, including failed jobs; live launch requires approval of this policy and backup retention. Cryptographic hashes are pseudonymous suppression identifiers, not guaranteed anonymous data.

Implementation and local verification: [ADR 0002](decisions/0002-durable-ingestion.md), [validation record](m2-validation.md), [rollout and residual risks](m2-rollout.md).
