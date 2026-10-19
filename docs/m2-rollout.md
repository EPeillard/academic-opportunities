# M2 rollout, recovery and residual risks

**Prepared only. No production migration, R2 write, Queue send, Worker deployment, DNS change or Email Routing activation is authorized by this PR.** The existing synthetic demo stays isolated. The earlier demo deployment approval does not authorize production ingestion.

## What is implemented

The private Worker implements Email, Queue and scheduled handlers. It stores original MIME (including attachments/forwards) unchanged in private R2, and commits receipt/job/outbox records in D1 before successful intake. Only a strict `{jobId}` payload reaches Queue. The placeholder verifies R2 integrity and records a versioned outcome; it does not parse attachments, extract opportunities, call an LLM or publish anything. HTTP always returns a generic 503 with no private data.

See [protocol/decisions](m2-design.md), [architecture](architecture.md) and [production resource runbook](deployment.md). Local config enables local processing only. Generated production config has both gates false and no Queue consumer or cron. An additional ignored activation config is prepared only by an explicit offline command. No production deployment workflow is added. The existing manual demo workflow and deployed demo are not changed by M2.

## Exact local validation

Node 24, no credentials, from repository root:

```sh
npm ci
npm run check
npm run db:migrate:local
npm run db:seed
npm run db:seed
npm run test:smoke
npm run test:demo
npm run test:ingestion
```

`test:ingestion` bundles with `--dry-run` and runs the actual Email/Queue/scheduled handlers in disposable Miniflare/workerd with simulated D1/R2/Queues. Outbound HTTP is blocked in this test. Vitest exercises real local D1/R2 with fault-injected service calls, concurrency and clock advancement. Missing/malformed Message-ID tests invoke the intake function directly: the pinned Miniflare email HTTP adapter itself requires Message-ID. It also imposes a 1 MiB local adapter cap; the direct-stream tests cover actual application limits. Tests make no SMTP delivery, remote API or account-privacy claims.

Interactive local rehearsal:

```sh
npm run db:migrate:local
npm run dev:ingestion
# In another terminal; these synthetic addresses never leave localhost:
curl --fail-with-body --request POST \
  'http://127.0.0.1:8788/cdn-cgi/handler/email?from=research@example.org&to=intake@example.org' \
  --data-binary @tests/fixtures/mime/plain.eml
curl --fail-with-body 'http://127.0.0.1:8788/cdn-cgi/handler/scheduled'
npx wrangler d1 execute DB --config apps/ingestion/wrangler.jsonc --local \
  --command "SELECT state, COUNT(*) AS count FROM jobs GROUP BY state"
```

Local simulator handlers are provided by Wrangler/Miniflare, not application HTTP endpoints; the pinned version uses `/cdn-cgi/handler/email` (current Cloudflare docs also show `/cdn-cgi/local/email`). Repost the same fixture to exercise idempotency. No `--remote` or `wrangler dev --remote` is appropriate for local tests. HTTP `/`, `/debug`, `/admin` and raw-mail paths on the application remain unavailable.

## Limits, configuration and retention

| Setting              | Default                           | Hard bound / behavior                                                                        |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `MAX_MESSAGE_BYTES`  | 2097152 (2 MiB)                   | 1024–10485760, actual bytes checked, rawSize must agree                                      |
| `MAX_DAILY_MESSAGES` | 500                               | 1–10000 new content admissions per UTC day; atomic SQL cap; exact retries reuse intent       |
| `RAW_RETENTION_DAYS` | 30                                | 1–90, expiry from first stored receipt; failed/dead jobs included                            |
| Header block         | 64 KiB                            | header framing validated, no MIME/HTML interpretation                                        |
| Stream read          | 10 s / 4096 chunks                | cancel on limit, exception or stall                                                          |
| Buffered intake      | 48 MiB reservation budget/isolate | reserve three times configured max size; excess is explicitly rejected                       |
| Processing           | 8 attempts, 120 s lease           | durable counters; 30 s exponential delay up to 1 h, expired leases retried by reconciliation |
| Queue                | batch 5, concurrency 1            | sequential processing; platform retries are transport recovery, not durable attempt counts   |
| Maintenance          | 5 records/phase                   | one phase per minute: retention, leases, job/outbox repair, R2 inventory, dispatch           |
| Queue watchdog       | 15 min                            | reissue unconsumed jobs independently of Queue retention                                     |
| Orphan grace         | 1 h                               | recover admitted content after verifying bytes/hash; purge aged unknown-prefix objects       |

Runtime controls are strings; invalid configuration fails closed. Keep `APP_ENV=production` only on the private production Worker. The public Worker remains without R2 or Queue bindings. Retention runs in bounded pages, so expiry is a due time, not a guarantee of instantaneous deletion. A full R2 scan can take multiple ticks and lengthens with bucket size; monitor inventory progress. The five-phase cadence bounds per-invocation D1/service operations for free-tier compatibility, but CPU and account quotas still require measurement. Do not raise limits before testing worst-case workerd memory/CPU and current Cloudflare allowances.

M2 does not expire suppression tombstones. They contain only the content hash and deletion dates; hashes are pseudonymous. Message/job shells remain for suppression/audit, with Message-ID hash and outcome cleared on deletion. Original sender/recipient/subject are not copied into D1; they exist only inside private MIME. No standalone attachments are created. Failed admission intents without a stored message are minimal hashes/dates and need periodic inspection; see residual risks. Provider logs must use a separately approved short retention (target 14 days); backups need an approved expiry policy. M3/M4 must extend deletion to any new derived/private artifacts before creating them.

## Production rollout checklist — future approval required

Perform commands in a trusted operator session or a separately reviewed, protected manual GitHub Actions job. Tokens belong in environment secrets, never chat, commands, repository variables or source. The CI workflow in this PR cannot deploy production. Do not reuse the demo environment's credentials/UUID accidentally.

1. **Obtain explicit production approval** for D1 migration, Worker deployment/Queue attachment/cron, retention policy and, separately, Email Routing. Review this PR and require green CI. Confirm no real emails/old pipeline rows were manually inserted into the inert M1 scaffold; otherwise audit/backfill them before rollout. Review quota/CPU feasibility, alerting and backup restoration with deletion suppression.
2. Supply nonsecret IDs in the secure execution environment: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` for **academic-opportunities-db**, and `CLOUDFLARE_DEMO_D1_DATABASE_ID` for **academic-opportunities-demo-db**. They must differ. Generate and inspect configurations offline:

```sh
npm run configure:production
npm run ingestion:prepare-activation
npm run ingestion:verify-target
npx wrangler deploy --config apps/ingestion/wrangler.activation.jsonc --dry-run --outdir apps/ingestion/dist-production
```

`verify-target` reads only D1 metadata and requires the exact production database name and UUID. The preparation command writes a gitignored config; it does not attach a consumer or cron remotely. Inspect: Worker `academic-opportunities-ingestion`, production DB UUID, R2 `academic-opportunities-emails`, Queue `academic-opportunities-ingestion`, `workers_dev:false`, `preview_urls:false`, no routes/custom domains or send-email binding. Local remote flags remain false; deployment bindings still identify real resources.

3. **Validate bucket privacy before any message:** Cloudflare R2 dashboard: Public Development URL disabled, no custom domains; review public Workers/service bindings/account credentials that might expose the same bucket. Record the result privately. Read-only CLI checks:

```sh
npx wrangler r2 bucket dev-url get academic-opportunities-emails --config apps/ingestion/wrangler.production.jsonc
npx wrangler r2 bucket domain list academic-opportunities-emails --config apps/ingestion/wrangler.production.jsonc
```

Require disabled public URL and an empty custom-domain list. Stop if unverified. A private binding does not repair bucket-wide public settings; CORS is not access control. No live R2 privacy check has been executed by this PR.

4. **Back up and migrate production D1 separately.** Store exports in approved private encrypted storage, never as a public CI artifact. These commands require explicit migration approval, do not include a seed:

```sh
npx wrangler d1 export DB --config apps/worker/wrangler.production.jsonc --remote --output /secure/private/academic-opportunities-before-m2.sql
npx wrangler d1 migrations list DB --config apps/worker/wrangler.production.jsonc --remote
npm run db:migrate:production
```

Only append-only `0002_durable_ingestion.sql` is new; migration tracking determines any unapplied prerequisites. Do not apply anything to the demo database, edit `0001`, run synthetic seed on production or combine migration with deployment. Verify applied migrations afterward with the same `migrations list` command.

5. **Deploy disabled first** after deployment approval; no email rule, consumer or schedule should be attached by this config:

```sh
npx wrangler deploy --config apps/ingestion/wrangler.production.jsonc
```

6. After approving background processing, **deploy the inspected activation config**. Wrangler registers the bounded Queue consumer and cron explicitly declared in that file:

```sh
npx wrangler deploy --config apps/ingestion/wrangler.activation.jsonc
```

This does not configure Email Routing or DNS. Check the Cloudflare Queue consumer and five-phase cron. If either is missing, stop intake; successful upload alone is not evidence of recovery being operational. The Worker has no public URL and cannot be tested with a public ingestion HTTP request.

7. **Email Routing is a separate final manual activation**, after its own approval. In the intended Cloudflare-managed email domain, create/review only the dedicated recipient rule with action Send to Worker → `academic-opportunities-ingestion`; leave unrelated routes untouched. Domain onboarding/MX/DNS changes are outside this PR and need separate approval/planning with the existing mail provider. Do not add a catch-all or subscribe lists at this stage. Start with one approved synthetic message, verify durable counts/hash-only logs and Queue completion, then enable approved sources gradually. To support Gmail forwarding, the owner creates a selective forwarding/filter rule to the dedicated address and completes Gmail's verification privately. Verification mail remains private MIME; this Worker does not auto-click links, reply or bypass Gmail verification. Do not connect mailing lists until real delivery/rejection behavior is checked.

8. Verify: R2 object private and length/hash correct under authorized access; one receipt/job/outbox for repeated exact bytes; `succeeded` integrity outcome; no opportunities created; no private information through public API; Queue/cron recovery during a controlled outage; explicit deletion suppression. Do not export raw email or private query results in support chats. Observe staged traffic before calling production ingestion operational.

### Required permissions

Scope account permissions to the intended Cloudflare account. Separate migration and deployment credentials where practical.

| Task                                                | Permissions                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Read-only D1 target check, migration listing/export | Account D1 Read (export may need D1 Edit depending on account policy; verify before rollout)   |
| D1 migration                                        | Account D1 Edit                                                                                |
| Private Worker deployment/bindings                  | Account Workers Scripts Edit, D1 Read, Workers R2 Storage Edit, Queues Edit                    |
| Consumer/cron management and recovery               | Queues Edit, Workers Scripts Edit as applicable; D1 Edit for private SQL recovery              |
| Bucket privacy checks                               | Workers R2 Storage Read                                                                        |
| Optional redacted tail                              | Workers Tail Read                                                                              |
| Final manual Email Routing                          | Zone Email Routing Rules Edit for the intended zone; DNS setup separately authorized if needed |

No DNS, Email Routing, R2, Queue or production token is given to normal CI or the public/demo Workers. Never broaden the existing demo token to production ingestion just to get a failing command to pass. Runtime bindings use platform authorization and contain no API/S3 tokens.

## Rollback and incident recovery

Stop new intake first by disabling the dedicated Email Routing rule manually under incident authorization. Do not reroute real email silently or delete R2/Queue/D1 resources. To pause safely without changing resources, deploy a reviewed config with `INGESTION_ENABLED=false`, `PROCESSING_ENABLED=false`; consumers retry while paused and Queue may eventually expire, but jobs/outbox stay in D1. Stop cron/consumer separately if required; the exact pinned CLI consumer removal command is below. Do not assume omitting a consumer from a config detaches a previously attached one.

```sh
npx wrangler queues consumer worker remove academic-opportunities-ingestion academic-opportunities-ingestion --config apps/ingestion/wrangler.production.jsonc
```

Remove/pause the ingestion cron in Cloudflare Workers Triggers if necessary, never other Workers' schedules. Preserve M2 D1 schema and raw objects. Rolling back to M1 code does not ingest email: keep Email Routing disabled. Do not reverse migrations with DROP TABLE or restore a stale DB over tombstones. D1 restoration requires separately approved reconciliation with R2, the freshest suppression records and consistent private backups.

Recovery when service resumes: restore enabled reviewed private Worker/consumer/cron configuration, inspect aggregate states and phase/cursor progress, let maintenance reclaim leases and reissue due jobs. Outbox publication can happen twice; consumers fence commits. Queue expiration needs no special raw re-upload. Unresolved R2/admission orphans are recovered after grace; deleting a corrupt/missing object does not recreate the original bytes. Persistent integrity failures stop as `dead` and require a private operator investigation.

Aggregate-only SQL checks (append `--remote` only after authorization):

```sh
npx wrangler d1 execute DB --config apps/ingestion/wrangler.production.jsonc --remote \
  --command "SELECT state, COUNT(*) AS count, MIN(updated_at) AS oldest_update FROM jobs WHERE stage='mime_integrity' GROUP BY state"
npx wrangler d1 execute DB --config apps/ingestion/wrangler.production.jsonc --remote \
  --command "SELECT COUNT(*) AS unsent, MIN(next_attempt_at) AS oldest_due FROM outbox WHERE sent_at IS NULL"
```

Alert on `STORAGE_UNAVAILABLE`, `OUTBOX_RETRY`, `CONSUMER_UNAVAILABLE`, `RECONCILIATION_FAILED`, `ORPHAN_INVALID`, growing oldest-due age, no maintenance progress or `JOB_DEAD`. Logs contain only enumerated event codes, no bodies, addresses, Message-IDs, errors or private headers. Platform logging/observability must be reviewed separately so automatic exception/request logging cannot disclose synthetic-adapter headers or real content.

Dead jobs are not automatically retried. Diagnose and fix the cause before a narrowly scoped, separately authorized private SQL repair. Verify no tombstone/deleted receipt; reset only the selected integrity job's attempt/state/lease/outcome with an audit record, then let outbox reconciliation recreate/rearm dispatch. Never bulk-reset all dead jobs, replay tombstones, or overwrite a newer leased attempt. No public reset/delete interface is supplied in M2.

## Remaining security and reliability risks

- No production SMTP, Email Routing, account permissions, privacy, cron or Queue integration was tested remotely. Local simulation cannot prove Cloudflare retry/bounce or Gmail forwarding verification behavior. `setReject` is permanent; storage outages or capacity rejection may require sender resubmission. D1/R2 committed before a rejection after an uncertain response can later be recovered; duplicates are safe.
- No distributed transaction exists. Fenced D1 state protects processing; raw objects written concurrently with deletion may persist until inventory, but tombstones block active jobs. Bucket corruption, external deletion, SHA-256 collision, inconsistent backup restore, storage failure beyond retention, or operator bypass can cause loss; cloud durability is not a tested backup strategy.
- Limits are per message/isolate and daily unique admissions, not an account-wide spam filter. Duplicate traffic still consumes operations. Authentication/abuse controls at Email Routing and budget/CPU/quota monitoring must precede public source onboarding. A full inventory at large scale may exceed grace/retention throughput; tune cadence and scale only after measuring, without increasing per-invocation resource bounds blindly.
- Exact-byte hashes do not merge changed headers, list footers, Gmail wrappers or semantically identical job announcements. Message-ID hash is supporting metadata only. MIME bodies, links and attachments remain untrusted and opaque; M3 needs bounded parsing, M4 needs real authorization.
- Retention tombstones and minimal message/job/admission shells require an approved privacy basis. Failed admission intents without MIME are not automatically pruned in this version; an operator must inspect aggregate growth and approve cleanup of aged intents only after verifying absence of raw storage and active work. Do not delete intents with orphan MIME awaiting recovery. Logs/backup expiry and a complete erasure workflow for future derived artifacts remain release work.
- Local tests use injected clocks and service failures, not real process-kill/account-outage tests. The consumer has no external side effects; future extraction/payment/publication steps must introduce their own idempotency/authorization boundaries. No LLM or automatic publication is included.
