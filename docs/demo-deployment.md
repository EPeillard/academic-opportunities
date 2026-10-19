# Isolated public demo deployment

Prepared 2026-10-19. **Preparation only: no resource provisioning, remote metadata check, remote migration/seed, deployment, email routing or DNS change has been executed.** Obtain explicit approval before running the remote steps below. Local tests and offline dry runs are safe to run now.

For a browser-only deployment with the token stored in GitHub Secrets, use [the GitHub Actions procedure](demo-github-actions.md). The manual workflow defaults to read-only verification and never deploys on push or PR.

## Exact target and boundaries

| Item                                    | Demo value                                                            |
| --------------------------------------- | --------------------------------------------------------------------- |
| Worker                                  | `academic-opportunities-demo`                                         |
| D1                                      | **New** `academic-opportunities-demo-db`                              |
| Public URL after an approved deployment | `https://academic-opportunities-demo.<account-subdomain>.workers.dev` |
| Binding                                 | `DB` only, plus Workers Static Assets `ASSETS`                        |
| Runtime marker                          | `APP_ENV=demo`                                                        |
| Generated configuration                 | `apps/worker/wrangler.demo.generated.jsonc` (gitignored)              |
| Website                                 | Existing React build from `apps/web/dist`                             |
| Schema                                  | Existing `apps/worker/migrations`                                     |
| Seed                                    | Existing `apps/worker/seeds/synthetic.sql`                            |

Never use `academic-opportunities-db`, `academic-opportunities-emails` or `academic-opportunities-ingestion` for demo operations. The public demo config has no R2, Queue, service, email or scheduled binding/trigger. It enables only the demo Worker's `workers.dev` route; version preview URLs are disabled and `routes` is empty. Local and production configuration files and identifiers are unchanged.

The demo API is read-only, anonymous, and restricted to `published` **and** `synthetic=1` records in lists, details, counts and country facets. Private review examples remain inaccessible. This extra filter is defense in depth; it does not replace using a separate database. The existing fixture creates eight published fictional opportunities and one private synthetic review row. Missing optional fields remain null. Fictional links point to example.org. The banner explicitly identifies synthetic data.

## Manual prerequisites

After approval for Cloudflare setup:

1. Select the intended Cloudflare account and record its Account ID.
2. In Workers & Pages, confirm the account's `workers.dev` subdomain; register one there if the account has none. No change to `etiennepeillard.com` is required.
3. Create a **new, empty** D1 database named `academic-opportunities-demo-db` in that account. Copy its UUID. Do not reuse or rename the production database. Dashboard creation is sufficient; the equivalent command is `npx wrangler d1 create academic-opportunities-demo-db` with the intended account selected.
4. Prepare an account-scoped API token in your secret manager. The demo runbook needs Account **D1 Edit** (migration, seed and target metadata verification) and **Workers Scripts Edit** (initial demo Worker creation/deployment). Scope to this account; use a demo-Worker restriction where available after initial creation. A separate D1 Read token suffices for target verification alone. No R2, Queues, Email Routing, DNS or Workers Routes permissions are needed. The Cloudflare account must allow creating the demo Worker and using its existing `workers.dev` subdomain. If permissions are denied, inspect the specific operation rather than adding zone permissions.
5. Supply the Account ID and **demo** database UUID. Never send or paste the token into a chat, commit or browser app. Inject `CLOUDFLARE_API_TOKEN` into the terminal through your secret manager for approved remote operations.

No Cloudflare credentials are required to run the local application or tests. Neither new tokens nor credentials are embedded in the demo Worker.

## Offline configuration and complete local verification

Run from repository root. Replace the ID placeholders with the values copied manually:

```sh
npm ci
export CLOUDFLARE_ACCOUNT_ID='REPLACE_WITH_32_CHARACTER_ACCOUNT_ID'
export CLOUDFLARE_DEMO_D1_DATABASE_ID='REPLACE_WITH_NEW_DEMO_D1_UUID'
npm run configure:demo
npm run check
npm run db:migrate:local
npm run db:seed
npm run test:smoke
npm run test:demo
npm run demo:dry-run
```

`configure:demo` does no network I/O. It creates only the ignored demo file and rejects invalid/local placeholder UUIDs and any production UUID known from `CLOUDFLARE_D1_DATABASE_ID` or existing generated production configurations. It does not rewrite local/production files. Keep the production UUID variable if already set; the demo generator uses the distinct `CLOUDFLARE_DEMO_D1_DATABASE_ID` variable.

`check` runs formatting, strict typechecks, all Vitest suites and builds/dry runs. `test:demo` applies migrations, seeds twice, starts the actual Worker and checks the SPA/API in a fresh temporary **local** D1 state directory. It cannot seed production or your ordinary local database. Its fixture account/UUID are simulated, not real Cloudflare resources. `demo:dry-run` validates the generated bundle offline and never publishes it; it does not prove real permissions, database existence, workers.dev availability or public browser rendering.

Local fixture seed commands above are for the ordinary disposable development database. The only supported **remote** seed command in this runbook is `demo:seed`, which is fixed to the isolated demo config. There is no production seed command and no automatic Cloudflare deployment in CI. CI additionally runs the isolated demo smoke without credentials.

## Approved remote sequence — do not execute until approval

Once the specific demo deployment is approved, ensure the token is injected, then run from the repository root:

```sh
npm run demo:verify-target
npm run demo:migrate
npm run demo:seed
npm run demo:deploy
```

Each mutation independently validates the complete demo config, makes a read-only Cloudflare D1 metadata request and requires the returned database name and UUID to exactly match the demo target. It aborts before any SQL or deploy if identity cannot be established. It rechecks that the config did not change while verifying. Known production IDs are rejected before metadata access. The metadata request does not execute SQL or inspect stored rows. A mismatch never falls back to a name, local database or production target.

These wrappers invoke the following exact Wrangler commands **after** those guard checks (shown for audit; prefer the guarded npm commands):

```sh
npx wrangler d1 migrations apply DB --config apps/worker/wrangler.demo.generated.jsonc --remote
npx wrangler d1 execute DB --config apps/worker/wrangler.demo.generated.jsonc --remote --file apps/worker/seeds/synthetic.sql
npx wrangler deploy --config apps/worker/wrangler.demo.generated.jsonc
```

Use no `--env production`, production config, production UUID, `wrangler dev --remote`, ingestion deploy, R2 command or Queue command. Migration and seed are separate from deploy; deploy does not run them automatically. The synthetic seed is idempotent and must never be applied to production. If migration/seed fails, stop and fix only the demo target before deployment. A successful API-identity check is not approval to deploy; the operator still needs the user's approval.

After deployment Wrangler prints the actual workers.dev URL; do not guess the account subdomain. Before calling the demo operational, run the following public checks against that URL (substitute the actual hostname), and open the listing and a detail page on desktop/mobile:

```sh
curl --fail 'https://academic-opportunities-demo.ACCOUNT_SUBDOMAIN.workers.dev/'
curl --fail 'https://academic-opportunities-demo.ACCOUNT_SUBDOMAIN.workers.dev/api/opportunities'
curl --fail 'https://academic-opportunities-demo.ACCOUNT_SUBDOMAIN.workers.dev/api/opportunities?type=Internship&country=France'
curl --fail 'https://academic-opportunities-demo.ACCOUNT_SUBDOMAIN.workers.dev/api/opportunities/phd-embodied-ai'
curl -i 'https://academic-opportunities-demo.ACCOUNT_SUBDOMAIN.workers.dev/api/opportunities/private-review'
curl -i -X POST 'https://academic-opportunities-demo.ACCOUNT_SUBDOMAIN.workers.dev/api/opportunities'
curl -i 'https://academic-opportunities-demo.ACCOUNT_SUBDOMAIN.workers.dev/api/admin'
```

Expected: 200 HTML; list total 8 with every `synthetic=true`; filtered total 1; 200 synthetic detail; private ID 404; POST 405; admin 403. Verify browser search/filter/navigation, the synthetic banner, mobile wrapping, deep-link reloads and security headers. Production data and live email ingestion are not part of this acceptance check. Actual public checks and real-browser visual QA remain pending until approved deployment.

## Temporary URL and cleanup

No automatic expiry is configured. After the demonstration, disable `workers.dev` for **academic-opportunities-demo only** in its Settings → Domains & Routes. Change the ignored demo config's `workers_dev` to false as well so a manual raw redeploy cannot re-enable it accidentally; the guarded demo deploy will then reject that config. Regenerating an enabled demo config is an explicit preparation for a later approved demo, not routine maintenance.

The local and production Worker settings must remain unchanged. Delete the demo Worker/database only after separate cleanup authorization and after confirming their exact demo names/UUID. Do not delete production resources. No raw messages or attachments should ever exist in this demo.

## Future custom domain

The intended final hostname is **jobs.etiennepeillard.com**. See [the custom-domain plan](custom-domain.md). No deployable demo config includes it. Attaching a Cloudflare Custom Domain creates DNS records/certificates, so activation is deliberately excluded from this demo deployment and requires separate approval.

## Official documentation reviewed 2026-10-19

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) and [asset headers](https://developers.cloudflare.com/workers/static-assets/headers/).
- [workers.dev setup, enablement and disablement](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
- [D1 database metadata API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/), [D1 migration/execute commands](https://developers.cloudflare.com/d1/wrangler-commands/).
- [API-token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).
- [Custom Domains and DNS behavior](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
