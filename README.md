# Academic Opportunities

An MIT-licensed open-source academic jobs aggregator for computer science and adjacent research disciplines.

**M1 public demo is deployed; M2 durable email ingestion is implemented and validated locally.** The [public demo](https://academic-opportunities-demo.etienne-peillard.workers.dev/) contains eight fictional opportunities and uses a separate synthetic database. M2 adds private R2 receipt, durable D1 jobs/outbox, integrity-only Queue processing, reconciliation and raw-MIME retention. **Production ingestion is not deployed or activated.** LLM extraction, publication automation and authenticated moderation remain future milestones. All examples are synthetic; links point to example.org.

## Quick start

Requirements: Node.js 24 LTS (see `.nvmrc`), npm, and a platform supported by Cloudflare workerd. No Cloudflare account, DNS, API key or LLM credentials required. Run commands from the repository root.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies API requests to the local Worker at http://127.0.0.1:8787. `dev` builds initial static assets then runs both servers. Local D1 persists under `apps/worker/.wrangler/state`; all migration/seed commands use the same workspace and explicit `--local`. Default bindings explicitly use local simulators. Stop both with Ctrl+C.

To test the built SPA and Worker at one origin:

```sh
npm run build
npm run preview
# open http://127.0.0.1:8787
```

`build` performs a Wrangler **dry run**, which bundles but does not deploy. `preview` runs Wrangler locally. Production configuration generation and future deployment commands are documented in [the deployment runbook](docs/deployment.md); production ingestion has no deployment workflow; the demo uses its separate manual workflow. The D1 ID is a local placeholder, not a provisioned resource.

## Verification

```sh
npm run check        # strict TypeScript, Vitest, Vite and Worker builds
npm run db:migrate   # actual Wrangler local migration
npm run db:seed
npm run db:seed      # safe to repeat: does not overwrite edited records
npm run test:smoke   # starts local Worker on 8799; tests HTTP + D1 + built assets
npm run test:demo    # disposable local demo regression checks
npm run test:ingestion # workerd Email -> private R2/D1 -> local Queue -> integrity outcome
```

The smoke test expects a fresh, seeded synthetic database and built assets. Vitest uses a separate ephemeral Miniflare D1 database; it never modifies development data. CI runs checks, migration, repeated seed and HTTP smoke; it has read-only repository permissions and no deployment secrets. Dependency versions and the lockfile are committed. Wrangler/Miniflare are pinned to a stable, mutually compatible release; update them together and rerun the real migration and HTTP smoke before adopting a new runtime. Browser layout QA is separate from API/build checks.

To reset development data, stop local servers and remove **only** `apps/worker/.wrangler/state`, then rerun migration and seed. This deletes local data, not remote resources. Seed generator: `python3 scripts/generate-seed.py` (optional; SQL is already committed). Never import the synthetic seed into production.

## Workspace

| Path              | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `apps/web`        | React, Vite, Tailwind public search and detail views               |
| `apps/worker`     | Read-only Worker API, Static Assets config, D1 migrations and seed |
| `apps/ingestion`  | Private Email/Queue/reconciliation Worker, locally enabled only    |
| `packages/shared` | Zod public contracts, extraction/evidence/permission contracts     |
| `tests`           | Contract, database/API and UI behavior tests                       |
| `docs`            | Architecture, product contract, phased plan and decisions          |

## Local API

- `GET /api/health`: runtime liveness (not a database readiness check).
- `GET /api/facets`: published countries and supported type/topic vocabularies.
- `GET /api/opportunities`: paginated, published records only.
- `GET /api/opportunities/:id`: published detail and approved public source references.

Filters: `q` (max 200 chars), `type`, `topic`, `country`, `publishedSince` (YYYY-MM-DD, inclusive), `deadlineBefore` (YYYY-MM-DD, inclusive), `includeUnknownDeadline=true|false`, `page` (1–1000), `limit` (1–50, default 12). All filters combine with AND. Unknown deadlines are excluded when a deadline cutoff is set unless explicitly included. Without a cutoff, null deadlines remain visible. Search is case-insensitive SQLite LIKE over title/organization/laboratory/description, with literal wildcard escaping. Results sort publication date descending, then ID. Filters and detail paths can be bookmarked. SQL is parameterized; malformed/unknown/repeated parameters return 400.

```sh
curl 'http://127.0.0.1:8787/api/opportunities?type=PhD&country=France'
curl 'http://127.0.0.1:8787/api/opportunities/phd-embodied-ai'
```

No public write endpoints. Unsupported API methods return 405. Admin paths return 403; private/unknown API routes return 404. Only explicitly selected published fields and validated HTTPS links enter public responses. Private tables, raw MIME, headers, quotes, revisions, moderation data and attachments are never returned. HTML-like description text is rendered as text by React, with no `dangerouslySetInnerHTML`. URL validation is a public-link policy, **not** an SSRF-safe fetcher; no server-side remote fetching exists.

## Design and remaining milestones

Read [architecture](docs/architecture.md), [product specification](docs/product-specification.md), [implementation plan](docs/implementation-plan.md), [ADR 0001](docs/decisions/0001-foundation.md) and [operations](docs/operations.md).

- M2 (this change): durable email intake, private R2, D1 jobs/outbox, Queue replay, reconciliation and raw retention. See [M2 design](docs/m2-design.md) and [rollout/recovery/risks](docs/m2-rollout.md).
- M3: MIME/extraction adapters, evidence, independent publication gates, safe summaries and deduplication.
- M4: authenticated private review/correction/merge/republication and audit.
- M5: recovery schedules, retention/deletion, monitoring, cost controls and reviewed deployment.

No routine human intervention is the target for validated incoming announcements; ambiguous cases still require review. Full text needs independent redistribution authorization. Null optional fields must not block publication. The database foundation does not itself implement these workflow gates.

## Manual actions

For M1: install dependencies, migrate/seed local D1 and start the app. Before future real intake: choose a domain, approve source/redistribution and retention policies, select an extraction provider and spending cap, configure verified server-side admin identities, and provision reviewed Cloudflare resources. Domain routing, Gmail forwarding and subscriptions are deliberately deferred. Do not commit `.dev.vars`, `.env`, credentials or real email samples.

## Manually provisioned Cloudflare resources

Bindings now use `academic-opportunities-db`, `academic-opportunities-emails` and `academic-opportunities-ingestion`. Run `npm run configure:production` with your account ID and provisioned D1 UUID to generate separate ignored production configurations. The public Worker has no R2/Queue binding. [Deployment and permissions](docs/deployment.md) includes exact local/remote migration commands and the required manual R2 privacy verification. No production migration, deployment or DNS change is performed by setup/build/CI.

## Isolated public demo

The [demo runbook](docs/demo-deployment.md) prepares a separate `academic-opportunities-demo` Worker and `academic-opportunities-demo-db` database, serving the existing website/read-only API on a temporary workers.dev URL. Run `npm run configure:demo` with the account ID and `CLOUDFLARE_DEMO_D1_DATABASE_ID`, then validate offline with `npm run demo:dry-run`. `npm run test:demo` rehearses the migration, repeated synthetic seed and HTTP checks against disposable local state. Remote migration/seed/deploy wrappers verify the demo database identity first; **do not execute them before deployment approval**. No R2, Queue, email handler or mailing list is connected. [jobs.etiennepeillard.com](docs/custom-domain.md) is a documentation-only future plan; DNS stays unchanged.

To deploy without a local terminal, follow [GitHub Actions demo setup](docs/demo-github-actions.md). Store the token in the protected `demo` environment secret and IDs/subdomain in environment variables. The manual workflow defaults to read-only verification; deployment requires explicit intent and approval.

## M2 private ingestion

Read [M2 rollout and local test instructions](docs/m2-rollout.md) before using the ingestion Worker. `npm run dev:ingestion` uses only local bindings; its HTTP interface deliberately returns 503. Send synthetic fixtures only through the local simulator's email handler. Production config generation always disables email/processing gates and strips consumer/cron triggers. `ingestion:prepare-activation` only prepares an ignored file offline and is not production approval. No production resources or the deployed demo are modified by M2 setup/tests/CI. Exact remote rollout commands are documented for a separately approved future operation; do not run them now.
