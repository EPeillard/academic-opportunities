# Implementation plan

## M1 — public foundation (completed)

1. Write architecture, specification, decisions and operational boundaries before code.
2. npm TypeScript workspaces, shared Zod contracts and strict typecheck.
3. Versioned D1 migration with private pipeline foundation and public projection tables; separate idempotent synthetic seed.
4. Read-only Worker API, parameterized queries, bounded pagination, public output allowlist and fail-closed admin paths.
5. React/Vite/Tailwind search, filters, detail views and responsive/error states.
6. Vitest contract and real local D1 integration tests, local HTTP smoke checks, production builds, CI without deployment credentials.

## M2 — durable intake (this change, local validation only)

Email Routing handler compatible with Gmail-forwarded MIME, private R2, bounded stream/hash, D1 admission/jobs/outbox, fenced Queue consumer, phased reconciliation, retention/tombstones and synthetic MIME fixtures. Gmail forwarding verification and real delivery activation remain manual future steps. See [M2 design](m2-design.md) and [rollout](m2-rollout.md). Acceptance: crash/replay at each durability boundary without loss or public leakage. Requires user-managed domain and Cloudflare resources only after explicit deployment scope.

## M2.5 — synthetic ChatGPT feasibility (this change)

Isolated OAuth resource Worker, REST/MCP synthetic batch bridge, strict nullable extraction/evidence contract, replay-safe private results and local protocol tests. No paid model calls or live connection. Deliver dated [feasibility assessment](chatgpt-feasibility.md) and [manual interactive/unattended test gates](agent-integration.md). A successful SDK rehearsal does not establish ChatGPT scheduled authentication or approval-free writes; production architecture cannot depend on them yet.

## M3 — extraction and publication policy

Bounded MIME parsing, provider-neutral adapter and fake, zero/multiple candidates, field evidence, schema versions, deterministic normalization, independent permission registry/privacy checks, summaries, exact/semantic duplicate candidates and revisions. Acceptance: adversarial instructions cannot access tools; optional nulls accepted; unlicensed full text blocked; uncertain dedupe reviewed; budgets enforced.

## M4 — private administration

Verified Access JWT server authorization, CSRF, queue UI, correction/reject/merge/republication, audit, conflict detection. Acceptance: unauthenticated and incorrectly scoped identities cannot read private data or mutate records; merges reversible through audit/revisions.

## M5 — operations and release

Schedules, durable retry recovery, DLQ, retention/deletion/tombstones, backup/restore drills, operational dashboards, rate limits, accessibility/browser checks, source permission review, deployment runbook and reviewed CI/CD environments. Deploy only after separate authorization; do not add DNS/accounts/email sending in M1. Acceptance: restore/replay after queue expiry, purge all derived data, budget and alert drills. Production deployment workflow comes here; M1 GitHub Actions is CI only.
