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

No remote deployment or GitHub-hosted CI run is claimed here. No email ingestion, R2, Queue, provider call, publication automation, real authorization, moderation, semantic deduplication, maintenance or retention enforcement has been exercised or implemented. Those are later milestones.

UI behavior tests run in Happy DOM, not a full browser. Desktop/mobile CSS is implemented, but real-browser visual/accessibility review is still required. A Chromium download attempt failed in this environment; no screenshot-based visual validation is claimed.

## Issues caught and resolved

The initial latest Wrangler pulled a beta simulator that reported a local migration success without retaining application tables. Pinning a compatible stable toolchain and starting with fresh disposable local state resolved persistence; the old simulator state was preserved outside the repository. Tests use Wrangler's SQL splitter so semicolons inside job descriptions remain intact. Explicit random inspector ports avoid interface discovery failures in restricted development environments. HTTP smoke detected that Worker headers alone do not protect directly served assets; `apps/web/public/_headers` now covers those responses.
