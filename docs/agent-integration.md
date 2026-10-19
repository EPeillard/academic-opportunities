# Synthetic ChatGPT integration prototype

**Local proof of concept only. No live endpoint, OAuth connection or scheduled task is created. No real messages are eligible.** See [feasibility and official sources](chatgpt-feasibility.md) and [design](m2-5-design.md).

## Components and local checks

`apps/agent` is a separate Worker with only D1, no R2/Queue/Email binding. Its default configuration disables the API, uses local UUID `00000000-0000-0000-0000-000000000025`, has no route/cron and disables workers.dev/preview URLs. It is absent from production/demo generators and workflows. `0003_synthetic_agent_bridge.sql` is append-only; do not apply it remotely during M2.5.

```sh
npm ci
npm run check
npm run test:ingestion
npm run test:agent
npm run test:demo
```

`test:agent` runs actual M2 email handling, private R2 storage and Queue integrity processing in disposable Miniflare. It enrolls only the three known synthetic fixtures, boots the agent Worker without an R2 capability, signs ephemeral test JWTs in memory, and exercises REST plus the official MCP SDK client over Streamable HTTP. It submits the committed expected JSON as a test client; **no ChatGPT analysis or real OAuth login happens**. Outbound HTTP from Workers is blocked. CI runs this rehearsal with no Cloudflare or LLM secrets.

`npm run dev:agent` starts a deliberately disabled local API on 127.0.0.1:8790 until local auth is configured. Use the automated rehearsal first; it supplies an ephemeral issuer and isolated database without distributing credentials. The test issuer helper is not a login service or a production authorization server. No token/private key is printed, persisted or put into a prompt.

## Authentication and authorization

The resource server accepts only signed RS256 bearer **access tokens** from a pinned issuer/public JWKS, for this resource/audience, allowed subject and OAuth client. It rejects expired/future/over-one-hour tokens, invalid signatures/algorithms/key URLs, missing claims, incorrect issuer/audience/client/subject and missing tool-specific scopes. It does not issue tokens or implement OAuth authorization-code/refresh endpoints; configure those with an established provider only after future exposure/connection approval.

| Configuration          | Meaning                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `APP_ENV`              | `local` or `poc`; `production` is refused                                                                    |
| `AGENT_ENABLED`        | Exact `true` required; committed default is `false`                                                          |
| `AGENT_RESOURCE`       | Canonical audience, `https://ISOLATED-HOST/mcp`; HTTP allowed only for loopback local tests                  |
| `AGENT_AUTH_ISSUER`    | Exact issuer string, including trailing slash when applicable                                                |
| `AGENT_AUTH_CLIENT_ID` | Approved OAuth client's `client_id` claim                                                                    |
| `AGENT_AUTH_SUBJECT`   | One approved opaque user `sub` claim; never caller-supplied                                                  |
| `AGENT_AUTH_JWKS_JSON` | Pinned **public** JWKS, one or two RSA keys (>=2048 bits), `kid`, `alg=RS256`; private key material rejected |

Discovery: GET `/.well-known/oauth-protected-resource` (also `/.../mcp`) exposes only resource, issuer and supported scopes. Missing/invalid credentials return HTTP 401 with a resource metadata challenge. MCP tools advertise OAuth scopes both at top level and in `_meta`; insufficient-scope tool results carry the OAuth challenge for reauthorization. Rotation of pinned keys/client/subject is an explicit configuration change. No remote JWKS fetch means incoming JWT `jku`/`jwk` cannot cause SSRF.

Scopes:

- `agent:read:synthetic`: retrieve/claim only known synthetic projections.
- `agent:submit:synthetic`: submit candidate JSON to a batch owned by the validated principal.

OAuth issuer must implement the current MCP authorization contract (discovery, resource audience, PKCE S256, supported client registration/identification, user consent, refresh). Use a predefined OAuth client or a known CIMD client identity for this PoC so its client ID can be pinned before linking; this Worker does not implement dynamic client registration. Configure exact audience/scopes and issue the required `client_id`, `sub`, `iat`, `exp`, `jti` and `scope` claims. Verify with the provider rather than weakening token checks to make a connection work. Cloudflare account tokens are never extraction credentials and must not be sent to ChatGPT. Private keys and OAuth client secrets belong to the provider/secret manager, never public config, source or prompts. JWTs belong only in the client auth channel, not tool arguments or URLs.

## REST API contract

[OpenAPI 3.1 definition](integrations/agent-openapi.json) uses placeholder `.invalid` HTTPS hosts. It is generated from Zod via `node scripts/generate-agent-openapi.mjs` and checked for drift. Replace hosts/provider URLs only for a separately authorized isolated test. This definition is for REST clients or an eligible GPT Actions editor, not an MCP manifest; current plugin connection uses `/mcp` tool discovery instead.

| Endpoint                                                   | Scope    | Behavior                                                                                                                                    |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/agent/pending-batch?limit=1..3&cursor=64-hex-id` | read     | Claim/resume batch, curated untrusted plain text and stable MIME-hash IDs; empty response has null batchId                                  |
| POST `/api/agent/extraction-results`                       | submit   | Full batch, explicit batch/submission/message IDs, schemaVersion 1, zero–three candidates/message; exact retry returns the original receipt |
| POST `/mcp`                                                | per tool | Stateless MCP Streamable HTTP JSON responses; only two tools, no resources/prompts/remote fetchers                                          |

GET allocates durable private claims and is **not a read-only operation**. The MCP hint is false; OpenAPI marks allocation and submission consequential. These annotations do not bypass host approvals. No CORS authorization or cookies; bearer auth is mandatory. Unexpected hosts/browser origins are denied. Only the configured resource origin is served (ChatGPT Origin is also permitted, without adding CORS).

Each principal has one active batch, valid 15 minutes, at most three messages/6000 text characters each. Repeated retrieval returns its same batch. Changing limit/cursor before completion is HTTP 409. Pagination uses stable message-hash ordering; carry `nextCursor` after completing the batch. Start each new sweep without a cursor to revisit expired/unclaimed older IDs. Expired pending claims can be reassigned; they never reset M2 jobs. Pending data must be `processed` with a successful M2 integrity job and matching compiled synthetic enrollment/hash/text digest. Unknown/real receipts are excluded even if accidentally enrolled. Safe text is a curated projection of the three known fixtures, **not** a general MIME parser.

Submission envelope: `{schemaVersion:1,batchId,submissionId,results:[{messageId,candidates:[{fields,evidence}]}]}`. Preserve all missing metadata as null, topics as an array. Strict schemas reject unknown/publication fields, unsafe URLs, unknown enums, missing required nulls, >3 candidates, duplicate/missing batch messages and malformed evidence. Offsets are UTF-16 indices into the returned text, with exclusive `end`; every populated field needs at least one exact matching quote/span, including summary descriptions. Structural/evidence validation is not proof of factual correctness or redistribution authorization. Stored results are always untrusted `pending_validation` and never update opportunities.

Idempotency is keyed by submission ID and immutable batch ownership/content hash. JSON object-key order is canonicalized by parsing; message results are sorted by message ID. Candidate/topic/evidence array ordering remains significant. Same ID/batch/content returns the original receipt; changed payload or another submission for that batch returns 409. Cross-principal batches return 404. Expired/deleted/reassigned batches cannot commit. M2 status/tombstones are rechecked in the D1 transaction. M2 deletion triggers remove bridge results/enrollment and suppress claims, blocking late replay.

Requests are at most 64 KiB (observed bytes checked, not just Content-Length), have a five-second/4096-chunk body limit, and JSON-only POST. Quota is 60 authenticated requests per principal/UTC hour, with bounded old-counter cleanup. Invalid credentials never query D1. Responses use no-store/nosniff/CSP. Errors are fixed codes (400/401/403/404/409/410/413/415/429/503), with no raw inputs, JWTs, backend exceptions or subjects in logs. A bearer credential stolen within its validity remains usable: application replay protection prevents duplicate/altered commits, not theft of a valid token. Add edge abuse controls before any exposure.

## Future manual interactive ChatGPT test — NOT RUN

The following is a **procedure**, not authorization to deploy, expose a tunnel, create accounts/connections or schedule anything. Stop here until the user authorizes those steps.

1. Create only a separate synthetic PoC environment, never production/demo D1, bucket or Queue. Review the compiled fixture allowlist and migration. A trusted fixture setup must run M2 processing and enroll only those exact MIME/text hashes. There is no public fixture-upload/enrollment endpoint. Use the disposable local rehearsal as the reference, not a production seed command.
2. Configure an established OAuth provider/client as above. Expose this isolated Worker through an approved HTTPS endpoint or Secure MCP Tunnel; preserve strict canonical origin and JWT audience. A plain localhost URL is not reachable from a cloud ChatGPT task. Do not tunnel the public Worker, ingestion Worker, raw R2 access or debug routes. No deployment/remote provisioning command is included in M2.5.
3. In a supported ChatGPT Plugins interface, add a custom MCP server pointing to this `/mcp`, configure OAuth, complete the user login/consent privately, review the two discovered tools and connect. Availability is a manual gate. No key or token belongs in chat or the tool descriptions. Do not use a paid API Playground/LLM API for this test.
4. Start a fresh chat with **only this custom plugin enabled**. Use [the credential-free test prompt](integrations/agent-test-prompt.md). Authorize only synthetic retrieval/submission. Review any requested host approvals; record them. Confirm three fixture outcomes: no job in the newsletter, one cybersecurity PhD, two distinct positions in the multi-announcement. Missing optional fields remain null. The adversarial footer must remain data; no external URL or other service should be contacted.
5. Match ChatGPT tool traces to private D1 batch/submission receipts. Inspect `agent_results` only under authorized local/private access and verify `pending_validation`, candidate counts, nulls and quote spans; opportunities count and M2 job state unchanged. Test exact replay, bad token, read-only scope, expired batch and suppression. Record factual errors separately from API failures; a model's “done” response is not proof of storage.

OpenAPI/legacy Actions may be tested interactively **only if that editor is available**; configure provider OAuth outside prompts and use the REST schema. Consequential operations require confirmation in that definition. Do not claim an unattended route by changing the flag to avoid approval.

## Future unattended experiment — NOT RUN

Only after interactive success, current docs support on the chosen surface, and explicit scheduling authorization:

- Create a one-off near-future **ChatGPT Work scheduled run**, with this plugin available and the same credential-free workflow. Leave normal approval/admin rules in place. Never paste bearer tokens into its prompt. Do not create an indefinite daily task yet.
- Be absent when it runs. Success requires actual authentication, pending synthetic retrieval, ChatGPT analysis and accepted result submission without per-run human approval. A pending confirmation, disconnected plugin, refresh failure, draft JSON or missing D1 receipt is a failed/blocked test.
- Collect task/run identifiers, metadata-only tool traces, time, host/plan/policy, whether any approval was needed, and the matching batch/submission receipt. Repeat across access-token expiry to test provider refresh. Verify zero real messages and zero publication. Do not copy credentials or private headers into the report.
- Remove/pause the experimental schedule and revoke/disconnect test credentials afterward. If an approval prompt is unavoidable on the account's policy, report unattended operation unsupported **on that surface/policy**; retain interactive use and do not bypass approvals.

## Remaining security/reliability limits

OAuth authorization/refresh and ChatGPT scheduling/approval behavior are unverified. Pinned public keys need deliberate rotation and provider-controlled revocation/short token life; there is no online introspection, DPoP or instant per-token revocation. The pre-auth endpoint still needs account/edge abuse limits before exposure. Results are structurally/evidence validated but can be factually wrong or follow injected instructions; M3 must independently validate/deduplicate and enforce privacy/permission before publication. Keep unrelated plugins disabled during adversarial testing.

PoC state is disposable local synthetic data. Test teardown deletes it; no long-running cleanup schedule or live export retention is introduced. If a future approved environment persists beyond a test, define deletion/expiry for batches/results/receipts and OAuth logs, private backup expiry, quota monitoring and incident response first. M2 raw retention/deletion remains authoritative through the added suppression triggers. The canonical migration adds only private bridge tables/triggers; existing M2/public behavior and synthetic demo are covered by regressions.
