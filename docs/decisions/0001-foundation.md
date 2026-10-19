# ADR 0001: local-first foundation and security boundaries

Status: accepted for Milestone 1, 2026-10-19.

Use npm workspaces and direct prepared D1 SQL: few dependencies and explicit public projections. SQLite schema constraints complement Zod. React plain-text rendering avoids a rich-HTML sanitizer dependency; any future rich HTML requires a separately tested sanitizer.

Use separate Vite dev server (5173, /api proxy) and Wrangler (8787). Both use one Worker D1 state directory; `npm run dev` starts both. Build web assets first; Wrangler serves the SPA and API from one origin for preview. This adds one local process versus the Cloudflare Vite plugin but keeps the Worker independently testable and makes persisted D1 location explicit.

A local placeholder D1 ID is committed; local-only default bindings and no committed account identifiers. An offline generator now prepares separate ignored production configurations; see [deployment](../deployment.md). Production provisioning and secret configuration are separate future work. CI checks builds but never deploys. There is no fake admin login or token in frontend code.

Keep D1 private tables separate from public metadata, source links and topic joins. M1 public reads are read-only; later ingestion must update publication status and approved revision atomically after gates. The M1 seed is synthetic and is not evidence of operational publication automation.

Schema anticipates future pipeline without implementing handlers. Trade-off: some unused tables now, but migration/evidence boundaries can be reviewed before real mail is accepted. Summaries by default; permission decisions are independent records, not a confidence threshold. Semantic deduplication remains deferred until evaluation fixtures exist.
