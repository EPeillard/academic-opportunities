# Architecture

Design reviewed 2026-10-19. Implementation status: Milestone 1 only, local development.

## Boundaries

TypeScript npm workspaces: `apps/web` (React, Vite, Tailwind), `apps/worker` (public API and Static Assets), `packages/shared` (Zod contracts). D1 owns relational metadata. The disabled ingestion scaffold in `apps/ingestion` prepares private resource bindings but implements no intake or processing. See [deployment configuration](deployment.md). Future email and processing Workers are separate from the public Worker: only they may bind private R2, queues, and extraction credentials. The public Worker must never have a raw-mail R2 binding. Public JSON is an explicit allowlist, not serialized database rows.

React renders plain text only. Public source and application URLs are HTTPS, validated at schema and response boundaries; credentials, local hostnames and IP literals are excluded. No remote URL fetching exists in M1. Administrative routes fail closed and have no implementation in M1. Future admin Worker requires Cloudflare Access JWT verification (signature, issuer, audience, expiry, approved identities) on every request, including API calls, plus CSRF protection for mutations. Hiding UI is not authorization.

## Future intake and processing (not implemented)

Dedicated domain address and Gmail forwarding both feed an Email Routing Worker. Limit message bytes before parsing (initial cap 5 MiB). Stream original MIME to a private R2 object keyed by SHA-256, then create D1 message/job and transactional outbox records. Acknowledge only after durable writes; do not rely on waitUntil alone. R2 and D1 are not transactional: a crash between writes leaves an orphan object. A scheduled inventory reconciler recovers objects lacking D1 jobs and removes expired orphans after a grace period. Outbox publisher can send twice; consumers must be idempotent.

Queue payloads contain job IDs, never email bodies. Consumer acquires a conditional D1 lease, parses bounded MIME with postal-mime, handles nested forwards and zero/multiple announcements, and records parser/provider/model/prompt/schema versions. Attachments stay private and are not executed, rendered or sent to a model by default. HTML becomes bounded plain text; remote images are never loaded. Email instructions are untrusted data: extraction gets no tools, secrets, or network capability. Provider output is untrusted until Zod and evidence checks pass.

LLM adapter contract: bounded input plus schema version, returning an array of candidates with nullable extracted values and field-level evidence (message ID, quote, span, source URL if independently verified), provider/model, usage, and extraction confidence. A deterministic fake adapter supports tests. Provider timeout, daily token/request budget, per-message cap, concurrency limit and circuit breaker bound cost. No provider implementation or network calls in M1.

## Publication and duplicates

Separate gates: relevance, extraction consistency, security/privacy, deduplication, and publication permission. Optional null fields do not block publication. Required public title, position and factual description must be supported. LLM confidence cannot authorize redistribution. Authorization requires a curated source policy or independently recorded explicit license/permission, scoped and dated; statements in incoming mail are not sufficient proof by themselves.

Default is independently written factual summary, with approved public source link when available. No established full-text permission means no full text. A summary without a public link can publish only if factual evidence and privacy checks pass; otherwise pending_review. Full text is a separately reviewed sanitized job-only artifact; never raw email. Signatures, phone numbers, personal addresses, forwarded discussion and headers are excluded. Contact defaults null publicly unless a role-based recruitment contact is explicitly approved.

Exact MIME hashes dedupe deliveries; normalized canonical application URLs and stable job IDs identify candidates, with organization/title/deadline fingerprints as supporting evidence. Semantic similarity only proposes matches, with calibrated thresholds and conflict checks; uncertainty goes to review. Multiple source rows attach to one canonical opportunity. New announcements create immutable revisions, not silent overwrites. Merge actions preserve aliases, sources, decisions and audit history. URL equality alone is insufficient for generic careers pages. All gates must pass before `published`; inconsistent updates cannot overwrite the last approved public revision.

D1 stores messages, durable jobs, outbox, opportunities, topic joins, public sources, private evidence, revisions, permission and extraction checks, and moderation audit events. Private evidence never enters public response schemas. M1 creates this foundation; it does not implement processing or enforce the future publication workflow.

## Recovery, limits and retention (future enforcement)

Jobs carry queued/processing/succeeded/failed/dead states, attempt count, next attempt, lease expiry and redacted error code. Exponential backoff with jitter, at most 8 attempts; permanent schema/security failures enter review. Cron re-enqueues due jobs, expires leases, repairs outbox, archives past deadlines after a 7-day grace period, and purges by retention policy. D1 is authoritative even after queue retention expires. Recovery must stop on a deletion tombstone.

Proposed defaults: MIME/attachments 30 days; failed/review MIME 90 days; private quotes and extraction payloads 90 days after resolution; redacted operational logs 14 days; public records archive after deadline and delete 24 months after archival; minimal nonpersonal audit and hash tombstones 24 months to prevent accidental reimport. Deletion removes R2 objects, evidence, revisions, public/search records and derived model data, and records a nonpersonal tombstone. Legal/privacy retention requirements must be approved before real email intake. Test deletion and backup expiry before launch. Local synthetic fixtures are retained until manually reset.

Use structured event/job IDs and reason codes, never bodies, headers, contact details or prompts in logs. Monitor job age, retry/dead rates, queue lag, R2 bytes, D1 reads/writes, provider tokens, publication/review rate. Start with 500 messages/day, 5 MiB/message, 20 candidates/message and configurable daily provider spend cap. Limits route overflow to durable deferred jobs or SMTP rejection before acceptance; never silently discard accepted mail. No operational limit enforcement exists in M1 beyond bounded API inputs and pagination.

## Official documentation reviewed

- [Static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/) — `_headers` applies security headers to assets served without invoking the Worker.
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) — integrated assets and Worker API hosting.
- [Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) — workerd integration available; M1 uses Vite proxy + Wrangler for explicit independent builds.
- [Local D1](https://developers.cloudflare.com/d1/best-practices/local-development/) and [migrations](https://developers.cloudflare.com/d1/reference/migrations/) — local simulation and versioned SQL.
- [Local resource data](https://developers.cloudflare.com/workers/local-development/local-data/) — local persistence is separate from production.
- [Email handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/) — raw stream and MIME parsing interfaces (legacy Email Routing documentation redirects here).
- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/) — free Queues retention is 24h; budget standard operations including retries.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/) — storage and operations are independent of Worker usage.

Free-tier compatibility is a design goal, not a zero-cost guarantee. R2 activation/account requirements, domain costs, Access eligibility, provider charges, and current quotas require verification before deployment. Static assets reduce Worker requests; bounded SQL avoids unlimited scans. M1 uses LIKE for small datasets; evaluate FTS/indexing and rate limiting before launch.
