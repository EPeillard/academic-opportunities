# Implementation plan

## M1 — local public foundation (this change)

1. Write architecture, specification, decisions and operational boundaries before code.
2. npm TypeScript workspaces, shared Zod contracts and strict typecheck.
3. Versioned D1 migration with private pipeline foundation and public projection tables; separate idempotent synthetic seed.
4. Read-only Worker API, parameterized queries, bounded pagination, public output allowlist and fail-closed admin paths.
5. React/Vite/Tailwind search, filters, detail views and responsive/error states.
6. Vitest contract and real local D1 integration tests, local HTTP smoke checks, production builds, CI without deployment credentials.

## M2 — durable intake

Email Routing + Gmail forwarding integration, private R2, streaming limits/hashes, D1 jobs/outbox, idempotent Queue consumers, reconciliation and synthetic MIME fixtures. Acceptance: crash/replay at each durability boundary without loss or public leakage. Requires user-managed domain and Cloudflare resources only after explicit deployment scope.

## M3 — extraction and publication policy

Bounded MIME parsing, provider-neutral adapter and fake, zero/multiple candidates, field evidence, schema versions, deterministic normalization, independent permission registry/privacy checks, summaries, exact/semantic duplicate candidates and revisions. Acceptance: adversarial instructions cannot access tools; optional nulls accepted; unlicensed full text blocked; uncertain dedupe reviewed; budgets enforced.

## M4 — private administration

Verified Access JWT server authorization, CSRF, queue UI, correction/reject/merge/republication, audit, conflict detection. Acceptance: unauthenticated and incorrectly scoped identities cannot read private data or mutate records; merges reversible through audit/revisions.

## M5 — operations and release

Schedules, durable retry recovery, DLQ, retention/deletion/tombstones, backup/restore drills, operational dashboards, rate limits, accessibility/browser checks, source permission review, deployment runbook and reviewed CI/CD environments. Deploy only after separate authorization; do not add DNS/accounts/email sending in M1. Acceptance: restore/replay after queue expiry, purge all derived data, budget and alert drills. Production deployment workflow comes here; M1 GitHub Actions is CI only.
