# Cloudflare configuration and deployment runbook

Prepared 2026-10-19. Resources are provisioned manually. These instructions prepare configuration; no production commands, resource creation, Email Routing changes or DNS changes have been executed by this change.

## Bindings and environments

| Binding           | Local simulation / provisioned production resource  | Worker               |
| ----------------- | --------------------------------------------------- | -------------------- |
| `DB`              | D1 `academic-opportunities-db`                      | Public and ingestion |
| `RAW_EMAILS`      | Private R2 `academic-opportunities-emails`          | Ingestion only       |
| `INGESTION_QUEUE` | Queue `academic-opportunities-ingestion` (producer) | Ingestion only       |
| `ASSETS`          | Built `apps/web/dist`                               | Public only          |
| `APP_ENV`         | `local` or `production`                             | Both                 |

`apps/worker/wrangler.jsonc` and `apps/ingestion/wrangler.jsonc` are local defaults. D1 uses the existing dummy UUID and all supported resource bindings explicitly use `remote: false`. The names can match provisioned resources because Wrangler's local simulators do not use the Cloudflare account. No remote preview bindings are configured.

Production is a separate, complete configuration file per Worker, **not** a named `--env` override. This avoids relying on binding inheritance. Always select it with `--config`; do not add `--env production`. Default npm development, build, seed and CI commands continue to use the local files. Never use `wrangler dev --remote` with real email data.

The ingestion Worker is a disabled configuration scaffold: HTTP returns 503; no `email()` or `queue()` handlers, consumer registration or schedule exists. Its Queue binding is producer-only. Do not connect an email address or add a consumer until durable ingestion is implemented and tested. There is no endpoint to read or write raw messages.

## Local development (no credentials)

From repository root:

```sh
npm ci
npm run db:migrate:local
npm run db:seed
npm run dev
```

Optional, in a second terminal:

```sh
npm run dev:ingestion
# http://127.0.0.1:8788 returns 503 intentionally
```

The public Worker persists under `apps/worker/.wrangler/state`. The ingestion command explicitly uses that same directory via `--persist-to ../worker/.wrangler/state`, so its DB binding shares the local D1 database. R2/Queue state also remains local there. Tests use independent ephemeral local state. `npm run build` bundles both Workers with `--dry-run`; it never deploys.

## Generate production configuration (offline)

Obtain the **account ID** and the **database UUID** from the manually created D1 database. Its name alone cannot identify the binding. IDs are not secrets, but generated files remain gitignored to prevent accidental use as local defaults. No token is read by the generator.

```sh
export CLOUDFLARE_ACCOUNT_ID='REPLACE_WITH_32_CHARACTER_ACCOUNT_ID'
export CLOUDFLARE_D1_DATABASE_ID='REPLACE_WITH_PROVISIONED_D1_UUID'
npm run configure:production
```

The generator rejects missing/invalid identifiers and the local placeholder UUID. It writes `apps/worker/wrangler.production.jsonc` and `apps/ingestion/wrangler.production.jsonc` alongside the respective local configurations so relative entrypoint/assets/migration paths remain correct. Review the generated files. Workers are named `academic-opportunities` and `academic-opportunities-ingestion`; routing and preview URLs stay disabled. A dry run validates the bundle, not account permissions, existence of resources, bucket privacy or remote connectivity.

```sh
npm run build:web
npx wrangler deploy --config apps/worker/wrangler.production.jsonc --dry-run --outdir apps/worker/dist-production
npx wrangler deploy --config apps/ingestion/wrangler.production.jsonc --dry-run --outdir apps/ingestion/dist-production
```

Do not use generated production configs with local seed commands. There is no production seed script. Output directories named `dist-production` are ignored by Git.

## Credentials and Cloudflare permissions

For future remote commands, inject `CLOUDFLARE_API_TOKEN` through a secret manager or protected GitHub Actions environment. Never put it in Wrangler config, source code, shell history, the browser, or generated files. `CLOUDFLARE_ACCOUNT_ID` selects the single account. `npx wrangler login` is an interactive alternative but requests broader OAuth access; scoped API tokens are preferable for deployment automation. No credentials are needed for any local check.

Cloudflare account API-token permissions for this runbook:

| Task                                               | Account permissions                                                 | Notes                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Inspect existing D1 / pending remote migrations    | D1 Read                                                             | No schema mutation                                                                        |
| Apply remote D1 migrations                         | D1 Edit                                                             | Use a separate migration token; no Workers or DNS permissions required                    |
| Deploy public Worker and static assets             | Workers Scripts Edit; D1 Read for resource inspection               | Existing DB UUID supplied; no R2 or Queue capability in the public Worker                 |
| Future ingestion deployment and binding management | Workers Scripts Edit; D1 Read; Workers R2 Storage Edit; Queues Edit | Conservative deployment/binding-management set; resource provisioning is already manual   |
| Inspect R2 privacy                                 | Workers R2 Storage Read                                             | Read-only checks below                                                                    |
| Manually provision/repair resources                | D1 Edit; Workers R2 Storage Edit; Queues Edit as applicable         | Separate from CI and outside this change                                                  |
| Optional account discovery                         | Account Settings Read                                               | Only if the operator needs account enumeration; explicit account ID is already configured |

Scope token account resources to **only the intended account**. Account-level R2/D1/Queue permissions can be broader than one bucket/database; do not treat them as bucket-scoped S3 credentials. Workers runtime bindings need no embedded API keys or S3 access keys. Use an existing-Worker resource restriction where available after initial creation; the initial deploy also needs permission to create that Worker. Cloudflare dashboard labels may display Write rather than Edit for equivalent API permission groups. Workers Tail Read is only needed for optional remote log streaming.

No Zone DNS Edit, Workers Routes Edit, Email Routing or Access administration permission is needed by these commands: no routes, custom domains, DNS records, email addresses or Access apps are configured. Add those permissions only for a separately authorized future operation. There is no deployment workflow or Cloudflare token in CI.

## R2 privacy prerequisite (manual account verification)

R2 buckets are private by default, but a Worker binding does **not** enforce or undo public bucket settings. Before any real MIME is accepted, verify `academic-opportunities-emails` has **Public Development URL disabled** and **no custom domains** in the dashboard. No public R2 URL, `r2.dev` enablement, presigned download endpoint or public Worker binding is included in this repository.

The following future read-only checks are supported by the pinned Wrangler version; run them with R2 Read credentials when ready:

```sh
npx wrangler r2 bucket dev-url get academic-opportunities-emails --config apps/ingestion/wrangler.production.jsonc
npx wrangler r2 bucket domain list academic-opportunities-emails --config apps/ingestion/wrangler.production.jsonc
```

Require development URL status disabled and an empty custom-domain list. If either check fails or reports public access, stop release/intake and repair the bucket manually. Do not enable `r2.dev`, add a custom domain, share S3 credentials or generate public links to raw objects. CORS is not an authorization control. This change does not inspect or modify the actual bucket's privacy state.

## Separate migrations and future deployment (do not execute yet)

Local migration (explicitly local, existing disposable UUID):

```sh
npm run db:migrate:local
# Equivalent, from repository root:
npx wrangler d1 migrations apply DB --config apps/worker/wrangler.jsonc --local
```

After explicit production authorization, with generated config and credentials, review pending production migrations, back up the existing database under your recovery procedure, then apply the **same canonical SQL migration files** to the provisioned database:

```sh
npx wrangler d1 migrations list DB --config apps/worker/wrangler.production.jsonc --remote
npm run db:migrate:production
# Equivalent:
npx wrangler d1 migrations apply DB --config apps/worker/wrangler.production.jsonc --remote
```

Migration application is separate from deployment and CI. It never runs as part of build/deploy. Applied migration tracking is independent per database; never copy local `.wrangler/state` to production or seed real D1 with synthetic data. Only `apps/worker/migrations` owns SQL; ingestion points to that same directory.

Future public Worker deployment, after the usual local checks:

```sh
npm run check
npm run test:smoke
npx wrangler deploy --config apps/worker/wrangler.production.jsonc
```

Future private Worker deployment command, **only after replacing the disabled scaffold with tested durable email/Queue processing in M2**:

```sh
npx wrangler deploy --config apps/ingestion/wrangler.production.jsonc
```

Both configurations have `workers_dev: false`, `preview_urls: false`, and no routes/custom domains. Deployment therefore does not create a public URL or change DNS. Choosing the eventual website hostname and enabling ingress are separate future actions. A successful deployment alone does not make email processing operational. Do not deploy the disabled ingestion scaffold as an intake service.

## Official references reviewed 2026-10-19

- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [environments and binding inheritance](https://developers.cloudflare.com/workers/wrangler/environments/).
- [Local resource behavior](https://developers.cloudflare.com/workers/local-development/), [Queue local development](https://developers.cloudflare.com/queues/configuration/local-development/), [Queue bindings](https://developers.cloudflare.com/queues/configuration/configure-queues/).
- [D1 migrations and command flags](https://developers.cloudflare.com/workers/wrangler/commands/d1/).
- [R2 public access](https://developers.cloudflare.com/r2/buckets/public-buckets/).
- [API-token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/).
