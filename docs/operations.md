# Operations and recovery

## Implemented in M1

Local-only D1 and Static Assets. Runtime failures return generic JSON and log a structured `public_api_error`/`READ_FAILED` code without payloads. API inputs and page sizes are bounded. There are no secrets, production resources, mail senders, background handlers or admin mutation endpoints. Local database contents persist until explicitly reset. Development HTTP has no real users or data; production rate limiting and readiness monitoring remain release blockers.

If schema is missing, stop the app and run `npm run db:migrate`; then `npm run db:seed`. If migration fails, inspect the local error without sharing private database contents. Migrations are append-only once used outside disposable development. Never edit an applied production migration; add a new numbered SQL file. `db:seed` is idempotent, not a reset. Real deployments must never use synthetic seed.

`npm run test:smoke` proves tables were retained and readable, beyond migration CLI exit status. It starts/stops a local Worker on port 8799. Tests do not assert anything about production infrastructure. This environment initially encountered a newer beta simulator migration persistence issue; the tested toolchain is deliberately pinned to stable Wrangler 4.100.0 and Miniflare 4.20260611.0, using compatibility date 2026-06-11. A newer documentation review date does not require newer runtime semantics.

## Before M2–M5 production release

1. Isolate public/read-only and private/processing bindings; verify no public path can access R2.
2. Configure provider and Cloudflare secrets outside Git; rotate on suspected exposure.
3. Test R2-first storage and failure reconciliation, D1 transaction/outbox replay, conditional leases and duplicate delivery at every boundary.
4. After queue expiry/outage: stop consumer if needed; inspect redacted job metrics; reclaim expired leases; enqueue due outbox/jobs in bounded batches; confirm succeeded jobs are not repeated and tombstoned mail is not resurrected.
5. Establish alarms on oldest due job, permanent failure rate and provider spend; pause extraction at budget limits while preserving durable intake. Reject oversized mail before accepting it. Measure operation costs with retry headroom.
6. Activate the architecture's retention schedules and R2 lifecycle backstop; test deletion across raw objects, attachments, evidence, revisions and public records. Honor deletions in backups; document maximum backup expiry. These policies are not enforced in M1.
7. Rehearse D1 backup/restore and R2 recovery under restricted credentials; verify counts, references and permissions before replay. Treat backups as private email data.
8. Verify Access JWT validation/CSRF and roles at the server boundary, sanitize previews, test malformed MIME and injection fixtures, and run desktop/mobile browser and accessibility checks.
9. Recheck current Cloudflare quotas/pricing and provider data retention before enabling any real sources. Explicit approval of source authorization and retention remains a launch requirement.

Use nonpersonal IDs in operational logs; never log email bodies, sender/recipient headers, personal contacts, attachments or extraction prompts. No automatic email replies are needed for this product.
