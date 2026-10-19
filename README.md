# Academic Opportunities

An MIT-licensed open-source academic jobs aggregator for computer science and adjacent research disciplines.

**Milestone 1: local public foundation.** Eight fictional opportunities, a read-only D1 API and a responsive public website are implemented. Email ingestion, LLM extraction, publication automation, moderation/authentication, queues, retention enforcement and deployment are **not operational**. All examples are clearly marked synthetic; links point to example.org.

## Quick start

Requirements: Node.js 24 LTS (see `.nvmrc`), npm, and a platform supported by Cloudflare workerd. No Cloudflare account, DNS, API key or LLM credentials required. Run commands from the repository root.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies API requests to the local Worker at http://127.0.0.1:8787. `dev` builds initial static assets then runs both servers. Local D1 persists under `apps/worker/.wrangler/state`; all migration/seed commands use the same workspace and explicit `--local`. No remote bindings are configured. Stop both with Ctrl+C.

To test the built SPA and Worker at one origin:

```sh
npm run build
npm run preview
# open http://127.0.0.1:8787
```

`build` performs a Wrangler **dry run**, which bundles but does not deploy. `preview` runs Wrangler locally. There is intentionally no production deployment command/workflow. The D1 ID is a local placeholder, not a provisioned resource.

## Verification

```sh
npm run check        # strict TypeScript, Vitest, Vite and Worker builds
npm run db:migrate   # actual Wrangler local migration
npm run db:seed
npm run db:seed      # safe to repeat: does not overwrite edited records
npm run test:smoke   # starts local Worker on 8799; tests HTTP + D1 + built assets
```

The smoke test expects a fresh, seeded synthetic database and built assets. Vitest uses a separate ephemeral Miniflare D1 database; it never modifies development data. CI runs checks, migration, repeated seed and HTTP smoke; it has read-only repository permissions and no deployment secrets. Dependency versions and the lockfile are committed. Wrangler/Miniflare are pinned to a stable, mutually compatible release; update them together and rerun the real migration and HTTP smoke before adopting a new runtime. Browser layout QA is separate from API/build checks.

To reset development data, stop local servers and remove **only** `apps/worker/.wrangler/state`, then rerun migration and seed. This deletes local data, not remote resources. Seed generator: `python3 scripts/generate-seed.py` (optional; SQL is already committed). Never import the synthetic seed into production.

## Workspace

| Path              | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `apps/web`        | React, Vite, Tailwind public search and detail views               |
| `apps/worker`     | Read-only Worker API, Static Assets config, D1 migrations and seed |
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

- M2: durable email intake, private R2, D1 jobs/outbox, Queue replay and reconciliation.
- M3: MIME/extraction adapters, evidence, independent publication gates, safe summaries and deduplication.
- M4: authenticated private review/correction/merge/republication and audit.
- M5: recovery schedules, retention/deletion, monitoring, cost controls and reviewed deployment.

No routine human intervention is the target for validated incoming announcements; ambiguous cases still require review. Full text needs independent redistribution authorization. Null optional fields must not block publication. The database foundation does not itself implement these workflow gates.

## Manual actions

For M1: install dependencies, migrate/seed local D1 and start the app. Before future real intake: choose a domain, approve source/redistribution and retention policies, select an extraction provider and spending cap, configure verified server-side admin identities, and provision reviewed Cloudflare resources. Domain routing, Gmail forwarding and subscriptions are deliberately deferred. Do not commit `.dev.vars`, `.env`, credentials or real email samples.
