# Milestone 1 verification

Verified locally on 2026-10-19 with Node 24.19.0, locked npm dependencies, Wrangler 4.100.0 and Miniflare 4.20260611.0.

- Clean `npm ci` succeeds.
- Prettier and strict TypeScript checks pass.
- Vitest: 39 tests pass (12 contract tests, 23 API/D1 tests, 4 Happy DOM UI tests).
- Contract coverage includes nullable metadata, zero candidates, invalid dates, unsafe links and independent full-text permission records.
- D1 integration uses real workerd SQLite bindings, applies committed migrations and seeds twice, exercises combined filters, literal wildcard search, SQL injection strings, pagination, private state isolation, invalid queries, source references, public country facets, invalid link failure and critical field constraints.
- UI tests cover navigation/details, nullable field labels, filter submission/bookmark URLs, recovery and escaped HTML-like description text.
- Vite production build and Wrangler bundle dry run succeed. Dry run does not deploy.
- Actual Wrangler local migration and two seed passes succeed.
- `npm run test:smoke` starts a local Worker and verifies HTTP API, eight published records, combined filters, details, hidden review record, denied administration, unknown API routes, SPA deep links, JavaScript assets and static security headers.

## Limits of this evidence

No remote deployment or GitHub-hosted CI run is claimed here. No email ingestion, production R2/Queue access, provider call, publication automation, real authorization, moderation, semantic deduplication, maintenance or retention enforcement has been exercised or implemented. Those are later milestones.

UI behavior tests run in Happy DOM, not a full browser. Desktop/mobile CSS is implemented, but real-browser visual/accessibility review is still required. A Chromium download attempt failed in this environment; no screenshot-based visual validation is claimed.

## Issues caught and resolved

The initial latest Wrangler pulled a beta simulator that reported a local migration success without retaining application tables. Pinning a compatible stable toolchain and starting with fresh disposable local state resolved persistence; the old simulator state was preserved outside the repository. Tests use Wrangler's SQL splitter so semicolons inside job descriptions remain intact. Explicit random inspector ports avoid interface discovery failures in restricted development environments. HTTP smoke detected that Worker headers alone do not protect directly served assets; `apps/web/public/_headers` now covers those responses.

## Resource configuration follow-up

The resource configuration change adds seven checks (46 tests total): local/production identifier separation, no R2/Queue binding on the public Worker, exact provisioned names and canonical migration path, rejection of missing/dummy production IDs, and simulated local D1/R2/Queue binding resolution. The ingestion scaffold remains disabled. A Wrangler D1 query using the ingestion configuration and shared persistence directory returned all nine local seed records (eight published plus one private review row), confirming the two configs share local D1. Both generated production configurations were bundled with fixture IDs in dry runs only; no Cloudflare API, migration, deployment, bucket privacy change or DNS operation was performed. Live bucket privacy still requires manual account verification from the deployment runbook.

## Public demo preparation follow-up

Locally verified after the resource-configuration merge: 65 passing Vitest tests, formatting and strict typechecks, public/private Worker builds, ordinary HTTP smoke, and the isolated demo HTTP smoke. The latter migrates a fresh temporary D1 state, applies the existing seed twice and checks the read-only API, filters, details, private denials, SPA deep links and static assets. A generated demo configuration with fixture IDs passes a Wrangler dry run and has only demo D1/ASSETS/APP_ENV bindings.

Guard tests mock Cloudflare metadata and mutation execution: wrong identities, known production/local UUIDs, private bindings, active custom domains and config changes are rejected. A real local D1 test verifies non-synthetic published records are excluded from demo lists, details and country facets while ordinary/local behavior is preserved. Local and production Wrangler files and production generator were not changed. No real Cloudflare account metadata request, resource creation, remote migration, remote seed, deployment, mailing-list connection or DNS operation was executed. Actual public URL acceptance and full-browser visual QA remain pending approval and deployment.
