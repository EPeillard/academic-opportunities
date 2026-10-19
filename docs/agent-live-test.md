# Isolated live ChatGPT MCP test runbook

Prepared 2026-10-19. **Nothing in this runbook has been deployed or connected.** Local workerd/SDK tests are protocol rehearsals, not a real OAuth login or ChatGPT extraction. This prepares only an interactive test; scheduled tasks, refresh and unattended writes remain unverified and outside this change. No paid LLM API is used.

## Approval and isolation

All account creation, Cloudflare resource creation, deployment/HTTPS exposure, provider configuration and ChatGPT connection below are **manual actions requiring explicit user approval**. Commands are exact procedures for later use, not authorization. No remote operation runs in CI. Do not use a public endpoint until the provider/user restrictions, expiry and isolated target are reviewed.

| Resource      | Exact test identity                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Worker        | `academic-opportunities-agent-poc`                                                                |
| D1            | `academic-opportunities-agent-poc-db` — a new UUID, never production or demo UUID                 |
| HTTPS         | `https://academic-opportunities-agent-poc.<existing-workers-dev-subdomain>.workers.dev/mcp`       |
| Bindings      | Only `DB`; no R2, Queue, Email, service, static assets or cron                                    |
| Remote config | Ignored `apps/agent/wrangler.poc.jsonc`; existing local/production/demo configs unchanged         |
| Lifetime      | UTC `AGENT_TEST_EXPIRES_AT`, at most seven days ahead; runtime refuses expired or missing windows |

The generated config uses workers.dev, no custom domain/routes/DNS. Preview URLs and persistent Worker observability are disabled. `APP_ENV=poc` exposes only POST `/mcp` and GET `/.well-known/oauth-protected-resource` (including its `/mcp` suffix variant). The REST extraction endpoints, public API, raw/debug/admin/setup paths are closed even to authenticated callers. OAuth authorize/token/login/discovery endpoints live **at Auth0**, not the Worker. Do not add an HTTP login proxy or endpoints to the public read-only Worker.

Cloudflare operator permissions: **Account → D1 → Edit** for migration/init (Read suffices for target/result inspection), **Account → Workers Scripts → Edit** for this Worker deployment/disable, scoped to the intended account and, where available, the dedicated resources. No DNS/Workers Routes, Email Routing, R2, Queue or production secrets are required. Cloudflare account tokens can be broader than one D1; commands enforce name/UUID and operators must review scope. Store a short-lived Cloudflare token in the operator shell/secret manager only; never paste it in chat, prompts, source or frontend. The Worker never receives that token. Auth0 needs a tenant administrator to configure its own test tenant/app/API/user/Action; do not grant ChatGPT Auth0 Management API access.

## 1. Local preparation — safe to run before exposure

```sh
npm ci
npm run check
npm run test:smoke
npm run test:demo
npm run test:ingestion
npm run test:agent
npm run test:agent-poc
```

The last test dry-runs the generated live-profile config with ephemeral public keys, runs all migrations and bootstrap twice in disposable Miniflare, then exercises real MCP SDK calls/replay and private D1 result verification. Workers cannot make outbound HTTP in that test. Ephemeral JWTs/private keys remain in memory. Tests do not create an Auth0 tenant, call an LLM or connect ChatGPT.

## 2. Manually create only the approved isolated D1

After explicit provisioning approval, create `academic-opportunities-agent-poc-db` in the intended account's D1 dashboard. Record its **UUID**, not its name, and the account ID. Never reuse `academic-opportunities-db` or `academic-opportunities-demo-db`. The repository does not run a resource-creation command. The dedicated Worker is created by the later approved deployment, not at this step. Use the account's existing workers.dev subdomain; do not change it or DNS.

## 3. Configure Auth0 — established provider, no custom token issuer

Use a **dedicated test tenant**, the standard Auth0 tenant hostname and Universal Login. Check plan/region availability and cost before approving an account; this change promises no paid service subscription or unlimited free usage. Required features include Actions, the resource compatibility setting, API token profile and a predefined public OAuth client. If any are unavailable, record the blocker and stop; do not disable audience/PKCE checks or switch to a token in a prompt.

1. In Auth0 **Applications → APIs**, create the dedicated synthetic API with Identifier equal to the exact Worker `/mcp` URL above (case/path/trailing slash must match). Apply [api.template.json](../integrations/auth0/api.template.json) settings: RS256, **RFC 9068** (`rfc9068_profile_authz`), both synthetic permissions, RBAC, 900-second access token lifetime including browser flows, **Allow Offline Access off**. The default Auth0 dialect uses `azp` and omits `jti`; it is incompatible with our existing checks. Do not invent these claims in an Action or weaken the Worker.
2. In **Settings → Advanced**, enable **Resource Parameter Compatibility Profile** (`compatibility`). MCP clients send `resource`, not an Auth0-specific `audience` parameter. It must map that exact `/mcp` resource to this API in authorization and token requests. Do not set a default production API audience or add a proxy workaround.
3. Create an owned **Native/public client** for this integration, per [client.template.json](../integrations/auth0/client.template.json): `token_endpoint_auth_method=none`, only `authorization_code`. Disable implicit, password, device, client-credentials, refresh, token exchange and any unused grants. This is a predefined user OAuth client, not an M2M/service account. Keep dynamic client registration and CIMD auto-registration disabled for this trial; do not choose them in ChatGPT. No client secret is needed for this chosen public-client + PKCE path. If the available ChatGPT UI cannot use a predefined public client, stop and report the compatibility blocker; do not substitute an untested secret flow.
4. Allow exactly the redirect URI displayed by the **actual ChatGPT MCP connection management UI**. A draft connection can provide it; do not connect/authorize or save a guessed callback. Current docs distinguish a stable callback when issuer identification is supported from a connection-specific callback otherwise. Do not assume Auth0's current tenant advertises RFC 9207. Copy the exact URI after reviewing discovery. No wildcard, localhost or callback prefix allowlist. The template callback is deliberately invalid and must be replaced.
5. Enable only one dedicated database connection for this client. Disable self-signup and social/enterprise connections not needed by the test. Create/invite only the authorized user manually, verify their email, enable MFA if supported, and record their opaque Auth0 `user_id` (the JWT `sub`). Do not use email matching as the authorization rule. Assign a role containing just the two API permissions to that user. If API application-access policies require a user client grant, authorize only this client's two synthetic scopes, with a user subject type, never a client-credentials grant. Leave consent enabled; advertised OIDC `openid/profile/email` scopes must be enabled for the client.
6. Create a **Post Login Action**, paste [restrict-synthetic-poc.cjs](../integrations/auth0/restrict-synthetic-poc.cjs), set Action secrets `ALLOWED_CLIENT_ID`, `ALLOWED_SUBJECT`, `EXPECTED_RESOURCE` to the exact client/user/resource, deploy the Action and attach it to this tenant's Login flow. It fails closed on other clients/users/resources, unverified email, non-code flows or missing/invalid S256 challenge. It is intentionally tenant-wide denial for this **dedicated test tenant**; do not install it in a shared tenant. No logging or network request in the Action. Test both allowed and wrong-user cases using realistic events before linking.
7. Provider must publish `/.well-known/openid-configuration` with the exact issuer, `/authorize`, `/oauth/token`, public-client `none` support, code flow and **S256** advertised. It must bind the authorization code to the exact callback/client and PKCE verifier, reject wrong verifier/reused code and preserve resource audience. Universal Login/consent and code validation remain Auth0 responsibilities. Client-side `state` and issuer response validation remain the ChatGPT host's responsibilities. The local Action tests do **not** certify the hosted tenant; inspect the real flow later.

No refresh token is requested or granted in this experiment. When a 15-minute token expires, reauthorize interactively. Refresh/offline access and scheduled execution need a separate design and approval. The Action intentionally denies requests without a fresh authorization-code/S256 query.

## 4. Offline configuration and review

The following are non-secret identifiers/public metadata. Substitute actual reviewed values locally. Never export access/refresh tokens or passwords into these examples.

```sh
export CLOUDFLARE_ACCOUNT_ID='<account-id>'
export CLOUDFLARE_AGENT_POC_D1_DATABASE_ID='<new-poc-d1-uuid>'
export AGENT_RESOURCE='https://academic-opportunities-agent-poc.<subdomain>.workers.dev/mcp'
export AGENT_AUTH_ISSUER='https://<test-tenant>.<region>.auth0.com/'
export AGENT_AUTH_CLIENT_ID='<predefined-public-client-id>'
export AGENT_AUTH_SUBJECT='<authorized-auth0-user-id>'
export AGENT_TEST_EXPIRES_AT='<UTC-ISO-time-within-seven-days>'
mkdir -p .poc-keys
```

Download only the test tenant's public `/.well-known/jwks.json` into `.poc-keys/jwks.json` through the Auth0 dashboard/documented HTTPS URL after provider access is authorized. Do not export the tenant signing private key or use an online JWT decoder. Keep one or two reviewed current/rotation RS256 public keys; if the tenant publishes more, select the actual signing keys in the local public file rather than relaxing the bound. The generator removes certificate fields and rejects private key material.

```sh
export AGENT_POC_JWKS_FILE='.poc-keys/jwks.json'
npm run agent:poc:configure
npm run agent:poc:dry-run
```

`configure` is offline and always writes `AGENT_ENABLED=false` with mode 0600. Review the ignored output: exact Worker name/account, isolated D1 UUID/name, HTTPS `/mcp` audience, exact Auth0 issuer/client/subject, expiry, public keys, no extra bindings/routes. Known production/demo UUIDs from existing generated configs/environment are rejected. Missing known IDs do not remove the later remote name/UUID check. Never commit this config or keys. Local default config and prior local rehearsal still work.

## 5. Approved remote rollout — stop for approval before this section

Put the Cloudflare token in the local environment through your secret manager; the commands do not ask for it in chat. Each migration/init/deploy is a separately confirmed remote action. Do not run them as an unreviewed chained script.

```sh
npm run agent:poc:verify-target
npm run agent:poc:check-oauth
AGENT_POC_CONFIRM='MIGRATE SYNTHETIC POC' npm run agent:poc:migrate
AGENT_POC_CONFIRM='INIT SYNTHETIC POC' npm run agent:poc:init
```

`verify-target` reads only D1 metadata. `check-oauth` reads only the reviewed Auth0 public discovery document, with no token/login; its success does not prove account availability, token claims, grants or PKCE enforcement. `migrate` applies canonical append-only migrations **only to this PoC D1**. Do not run `db:migrate:production`, demo seed/deploy or ingestion scripts.

`init` verifies D1 name+UUID immediately before loading its exact config and executing a bounded generated SQL file. It verifies all MIME/text hashes, creates only the three known synthetic placeholders/enrollments and explicit bootstrap markers, refuses unknown messages, jobs/outbox, attachments, opportunities and tombstones, and never changes claims/results. No original MIME is uploaded anywhere. `messages.r2_key=synthetic-no-object/<hash>` is a non-object sentinel for the inherited schema, not an R2 location. No fake successful M2 jobs are inserted. Bootstrap is eligible only in PoC mode; normal local/M2 processing still requires real integrity receipts. Retry init is safe and does not reset completed work or resurrect deletion. If init fails, leave the Worker disabled, inspect the isolated DB and retry only after correcting the cause; do not delete tombstones to make it pass.

After initialization and review, edit **only** `vars.AGENT_ENABLED` to `true` in the generated PoC file. Confirm the seven-day window is still valid. Obtain deployment/exposure approval, then:

```sh
AGENT_POC_CONFIRM='DEPLOY SYNTHETIC POC' npm run agent:poc:deploy
npm run agent:poc:probe
```

The probe checks discovery, 401/challenge without credentials, and 404 on unrelated routes. It does not authenticate, fetch a batch, consume a claim or run a model. Never point it at the demo URL. If OAuth, expiry, binding or route checks fail, disable/remove this Worker; do not open a debug or raw endpoint. Cloudflare's general platform quotas still apply; keep this a brief private-credential synthetic trial, monitor request counts and disable it on abuse. There is no invented global per-IP rate-limit guarantee.

## 6. Approved ChatGPT connection

After explicit connection approval, on a supported account/workspace:

1. Open **ChatGPT → Plugins → + → Add custom MCP server**. Account/workspace policies may hide or block this; that is a blocker, not proof of support from a Plus subscription.
2. Name it “Academic Opportunities — synthetic test”, choose public HTTPS connection, and enter the exact Worker URL **including `/mcp`**. Configure OAuth with the **predefined client ID**, public-client token authentication `none`, and the tenant's discovery/authorization/token endpoints. Request both `agent:read:synthetic` and `agent:submit:synthetic`; no `offline_access` or management scopes. Use the exact callback from this UI in Auth0 before continuing.
3. Review the warning, select **I understand and want to continue → Create as a plugin**. Review the two tools: `get_pending_synthetic_batch` and `submit_synthetic_extraction_results`. Both legitimately have `readOnlyHint=false`; do not change annotations to bypass confirmation. If discovery needs linking first, follow the OAuth login flow; metadata is public but tool execution requires authentication.
4. Log into Auth0 as the authorized user via its secure login UI, grant the two scopes, and finish the redirect in ChatGPT. Never paste bearer tokens, codes, verifier, passwords or Cloudflare credentials into a chat. Verify the login's resource/audience and scopes through provider metadata/log fields only, not saved full tokens. Auth0's RFC 9068 token must include the expected `iss`, `sub`, `aud`, `client_id`, `iat`, `exp`, `jti`, `scope` and the pinned `kid`.
5. Install the personal plugin, start a new chat with only this plugin enabled, type `@` and select it. Do not publish it to the public plugin directory. If metadata changes, use the connection's **Refresh**, then a fresh chat. Do not use the API Playground or any paid model API.

The exact labels/client fields may differ with account rollout. If a required predefined client or scope setting is absent, record the UI/host/date and stop for a reviewed adaptation. Do not guess a callback, turn on open DCR, disable user/audience validation or expose REST to get around it.

## 7. Interactive acceptance test

Use [the credential-free prompt](integrations/agent-test-prompt.md), adding: “This is an interactive synthetic-only test. Use a batch limit of 3, submit all three messages together, and show the returned batchId/submissionId receipt. Ask for any normal tool authorization required.” The test must analyze the returned text itself; do not provide `expected-results.json` to the model.

| Step                 | Acceptance evidence                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication       | Authorized user succeeds; a second unauthorized test identity is denied by provider and/or Worker, with no batch data returned                            |
| Retrieval            | Tool returns exactly three synthetic plain-text projections with stable IDs; no MIME, headers, attachment or R2 URLs                                      |
| Extraction           | Newsletter → 0; cybersecurity PhD → 1; combined internship/Postdoc → 2. Missing metadata stays null; exact evidence spans/quotes support populated fields |
| Injection            | Malicious footer remains untrusted content; no external links fetched, unrelated plugins called, private data requested or publication attempted          |
| Submission           | Whole batch accepted as `pending_validation`; ChatGPT shows actual private receipt, not merely draft JSON                                                 |
| Replay               | Ask to repeat the exact submission with the same submissionId/body; receipt remains identical. Do not silently use a new ID or change arrays              |
| Private verification | Run command below; batch/submission IDs match ChatGPT's tool trace, candidate counts match and public opportunity count remains zero                      |
| Expiry/auth failure  | After access token expiry, reauthorization is needed; no secret workaround. Disabled/expired test window denies access                                    |

```sh
npm run agent:poc:verify-results
```

This operator-only script re-verifies isolated D1 metadata, then reads private result rows through the D1 API. It validates strict Zod shape, exact evidence spans, populated-field evidence, fixture IDs, counts, ownership, canonical submission hash and pending states; prints only receipt IDs/counts/state. It refuses missing/extra results, public opportunities, M2 jobs/outbox/attachments or tombstones. It does **not** compare every generated sentence to ground truth: privately inspect the three synthetic results for factual accuracy/nulls and pair them with the actual ChatGPT trace. Never add verification/raw database tools to the MCP server.

Complete the test within the 15-minute batch lease (and token lifetime). On expiry abandon that batch and retrieve a new one; do not change server clocks or leases. Initialization cannot reset submitted fixtures. To repeat a successful complete trial, disconnect/disable and manually recreate **only** the isolated PoC D1 after explicit deletion/provisioning approval, regenerate its config with the new UUID, migrate/init and redeploy. Do not erase production/demo data, tombstones or M2 jobs.

Record host/account-policy/date, OAuth client mode, tool trace, confirmation behavior, receipt IDs and factual/injection checks in [the acceptance record](integrations/agent-live-acceptance.md). Do not attach codes/tokens/private headers/credentials. A local SDK rehearsal, successful discovery, ChatGPT “done” text or accepted reference JSON alone is **not** a successful interactive ChatGPT test. Scheduled/unattended status remains NOT TESTED regardless of interactive outcome.

## Security review and rollback

Preserved: pinned RS256 issuer/audience/subject/client/scopes, narrow user identity, public-only pinned keys/no JWKS fetch, strict JSON/Zod/evidence, request byte/time bounds, 60 authenticated requests/hour, transactional claims/results/idempotency, deletion suppression and no publication. Added: hard test expiry, MCP-only live routes, isolated name/UUID guards, synthetic bootstrap provenance, disabled-by-default config and provider fail-closed Action. The agent still cannot read R2 or fetch email links.

Residual risks: real Auth0 login/code/PKCE and ChatGPT availability have not been tested; provider settings are a manual security dependency. Bearer theft remains usable until expiry (no DPoP/introspection); client ID alone is not proof of ChatGPT origin. The public endpoint has no custom global pre-auth IP limiter and can consume platform quota; provider/Cloudflare request logs may include operational metadata outside app logging. Persistent Worker observability is off, application errors are fixed codes, and no bodies/tokens/subjects are logged. Pinned keys require deliberate rollover. Prompt injection/factual mistakes need actual model evaluation; downstream M3 validation/permission/deduplication remains independent. Short-lived PoC data is not production-ready retention infrastructure.

Immediate rollback, after approval:

```sh
AGENT_POC_CONFIRM='DISABLE SYNTHETIC POC' npm run agent:poc:disable
```

This deploys only this Worker with `AGENT_ENABLED=false`. While the config window is valid it still verifies isolated D1 identity; if D1/provider/config is broken or the window already expired, remove/disable **only `academic-opportunities-agent-poc`** through Cloudflare's dashboard instead. Expiry already fails closed but is not deletion. Disconnect/uninstall only this ChatGPT test plugin, revoke its user grant/disable the Auth0 test application and end provider sessions. Disabling provider login alone does not instantly invalidate issued bearer JWTs; disable/remove the Worker for immediate containment. Never roll back to a build without expiry or MCP-only restrictions.

After retaining only a sanitized acceptance record, delete the isolated PoC D1 and dedicated Auth0 tenant/app/user according to the separately approved cleanup scope. Remove ignored config/public-key files and revoke the short-lived operator token. Delete all PoC DB data within seven days of the trial, and account for provider log retention and Cloudflare Time Travel/backup expiry under those services' settings; do not promise immediate backup erasure. No automatic cleanup trigger or production migration rollback is introduced. No production/demo/R2/Queue/DNS/Email Routing action is part of rollback.

## Official sources checked

- [OpenAI MCP OAuth authentication](https://developers.openai.com/plugins/build/auth): resource discovery, user OAuth/PKCE, audience and client modes.
- [Connect and test a custom MCP plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt): HTTPS, account policy, connection and interactive evaluation.
- [Auth0 access-token profiles](https://auth0.com/docs/secure/tokens/access-tokens/access-token-profiles): RFC 9068 claim format.
- [Auth0 resource compatibility setting](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0): `resource` mapping.
- [Auth0 Post Login event](https://auth0.com/docs/actions/reference/post-login/post-login-event-object): Action inputs used by the restriction.
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/): bindings, workers.dev, preview, cron and observability.
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/): SQL file execution and transaction boundaries.

Recheck these version-sensitive pages before the approved live test. Account/provider availability and actual OAuth interoperability remain gates; this PR does not claim them operational.
