# M2.5 validation record

Date: 2026-10-19. Base: main at `e08e7da4fa7c1be0e8a76f0836d12b9d14235bba`. Node 24, pinned Wrangler/Miniflare and MCP SDK versions in package-lock.json. All Cloudflare execution below uses local simulations; no remote migration, deployment, data write or integration connection was performed.

| Check                                          | Result                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                | Passed: formatting, TypeScript, 191 Vitest tests (134 existing, 57 added), React production build and public/ingestion/agent Worker dry-run bundles                               |
| `npm run db:migrate:local`                     | Passed, including append-only migration 0003                                                                                                                                      |
| `npm run db:seed` twice                        | Passed; existing synthetic seed remains idempotent                                                                                                                                |
| `npm run test:smoke`                           | Passed: local public API and static website                                                                                                                                       |
| `npm run test:demo`                            | Passed: isolated synthetic demo configuration and API                                                                                                                             |
| `npm run test:ingestion`                       | Passed: existing workerd M2 durability rehearsal                                                                                                                                  |
| `npm run test:agent`                           | Passed: real local M2 ingestion/Queue, private R2 fixtures, isolated D1 agent, REST and SDK MCP round trip, idempotent synthetic JSON submission; no public opportunities created |
| Actual ChatGPT interactive extraction          | **NOT RUN**: requires separately authorized HTTPS/tunnel exposure, OAuth provider and account connection                                                                          |
| Actual ChatGPT unattended scheduled extraction | **NOT RUN**: same blockers, plus availability, token refresh and approval policy must be verified                                                                                 |

The local client submits committed reference JSON, not model-generated results. It proves the transport and storage boundaries, not extraction quality or an approval-free ChatGPT schedule. See [feasibility assessment](chatgpt-feasibility.md) and [manual acceptance procedure](agent-integration.md).

New automated coverage includes strict JWT/scopes/subject/client checks, bounded batch pagination, claims and concurrent allocation, zero/one/multiple opportunities, exact evidence/null validation, rate limits and request bounds, canonical replay/conflicts, concurrent commits, transaction rollback, expiry/reassignment, deletion/tombstone races, private fixed errors, unknown-message exclusion, OAuth MCP metadata/challenges and OpenAPI drift. Fixture enrollment and compiled hashes prevent access to arbitrary real messages. M2 jobs and public opportunity rows are checked for unwanted mutations.

Public website/API sources, M2 ingestion sources, demo configuration generator, demo workflow and demo seed were not modified. CI runs the new local rehearsal without credentials. This record does not claim that live OAuth, ChatGPT linking/scheduling, provider refresh, model prompt-injection resistance or production extraction has been validated.
