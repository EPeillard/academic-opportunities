# Demo deployment through GitHub Actions

This is the browser-only alternative to running commands on your own computer. It wraps the existing guarded scripts; no Cloudflare operation is triggered by merging the workflow. Deployment still requires the user's explicit approval. Never paste an API token into chat.

## One-time manual setup

1. Merge the workflow PR into `main`. GitHub only shows the manual workflow button after the workflow exists on the default branch.
2. Open repository **Settings → Environments → New environment**, create **demo**.
3. Under Deployment branches and tags, allow only the `main` branch. Under Required reviewers, add the person who approves demo deployments. If you are the only reviewer and also start runs, leave Prevent self-review unchecked. Configure these rules before making the token available. Environment protection rules are managed in GitHub Settings, not by this workflow.
4. In that environment's **Environment secrets**, add `CLOUDFLARE_API_TOKEN`. Paste the token directly into GitHub's secret field. Use Account D1 Edit and Workers Scripts Edit, scoped to the intended account; no R2/Queues/DNS/Email Routing permissions are needed. The token is never stored as a variable or committed to Git.
5. In **Environment variables** (not secrets), add the following values:

| Variable                         | Value                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`          | Account ID from Cloudflare Workers & Pages → Account Details, or Ctrl+K → Copy account ID |
| `CLOUDFLARE_DEMO_D1_DATABASE_ID` | UUID of **academic-opportunities-demo-db**, not the production database                   |
| `CLOUDFLARE_WORKERS_SUBDOMAIN`   | Only the account subdomain, such as `example-account`; omit `https://` and `.workers.dev` |

Find the D1 UUID by opening the existing demo database's overview/settings in Cloudflare. It is a UUID, not its name. Do not recreate or rename resources. If you already have a token with the required permissions, reuse it through the GitHub secret field; do not share its value. No local `wrangler login` is needed on this route.

## First run: read-only verification

Go to **Actions → Demo - verify or deploy → Run workflow**:

- Branch: `main`.
- Operation: **verify** (the default).
- Confirmation: leave empty.

Approve the `demo` environment job when GitHub asks. This run installs locked dependencies, runs local tests/builds and the isolated local demo rehearsal, generates the demo config, validates the expected URL, runs the offline demo dry run and verifies the demo D1 identity through the Cloudflare metadata API. It does **not** migrate, seed or deploy anything remotely. Its summary explicitly confirms that no remote mutation ran. Fix failed settings/permissions before requesting deployment approval.

## If target verification fails

Keep operation **verify** while troubleshooting. The identity check reports HTTP failures, unsuccessful API envelopes (numeric error codes only), invalid JSON, and name/UUID mismatches separately. It does not log the token, raw response, or arbitrary Cloudflare error messages.

- HTTP 401/403 or an unsuccessful API response: check that the environment secret is present, the token has D1 access for the intended account, and the account ID/database UUID are correct. Do not broaden permissions blindly.
- Database name differs: open the database identified by `CLOUDFLARE_DEMO_D1_DATABASE_ID` and confirm its name is exactly `academic-opportunities-demo-db`. Correct the GitHub variable if it points elsewhere; never rename production to bypass this check.
- UUID differs or a field is missing/invalid: confirm the UUID in the demo database overview and inspect the current official D1 metadata API schema before changing the validator. Do not bypass identity verification.

After correcting the configuration or merging a diagnostic fix, start a **new** workflow run on `main` with operation **verify**. Re-running an old failed job uses its original workflow/code revision. No remote migration, seed or deployment should be started to diagnose this step.

## Deployment: only after explicit approval

Once the read-only verification succeeds and the user has approved demo migration/seed/deployment, start another manual run:

- Branch: `main`.
- Operation: **deploy**.
- Confirmation: type exactly **DEPLOY DEMO**.

Approve the protected `demo` environment job. An omitted/wrong phrase fails before Cloudflare access. A deployment on another branch is skipped. There are no push/PR/scheduled deployment triggers; CI remains separate. Do not dispatch the deploy operation or approve its environment until the specific deployment is authorized. The confirmation phrase complements GitHub environment protection; it does not configure required reviewers for you.

The workflow then runs the existing commands in order:

```sh
npm run demo:verify-target
npm run demo:migrate
npm run demo:seed
npm run demo:deploy
npm run demo:verify-live
```

Migrate/seed/deploy each recheck the target identity and reject production/invalid capabilities. The Cloudflare token is scoped only to the metadata and guarded mutation steps: it is not passed to dependency installation, tests, builds, frontend code or public URL verification. Generated configurations, credentials and raw log files are not uploaded as artifacts. Concurrent demo runs are serialized; a new run does not cancel a migration already in progress.

If the migration, seed or deployment fails, later commands stop. Inspect the error and rerun only after resolving it; existing migration tracking and synthetic seed are idempotent. This does not roll back successful prior remote steps automatically. A live verification failure after a deploy means the demo must not be reported as verified; inspect the demo URL/settings without touching production.

## Live verification and result

The verification script accepts only `https://academic-opportunities-demo.<subdomain>.workers.dev`, sends no Cloudflare token and refuses redirects. It checks readiness, eight unique published synthetic records, the France/internship filter, a detail response, private ID denial, POST denial, admin/raw endpoint denial, SPA deep links, security headers and same-origin built JavaScript assets.

On success the workflow summary contains the clickable public demo URL. Real-browser desktop/mobile visual review is still manual. Share that public URL or the run URL with the assistant for independent verification; never share the token. Do not manually create or change DNS or attach `jobs.etiennepeillard.com` during this procedure.

This workflow has been prepared and locally tested. An actual GitHub-hosted manual run and Cloudflare account/permissions/live URL cannot be verified until you configure the environment and authorize the corresponding operation.

References: [GitHub environments and protection rules](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [demo resource/deployment runbook](demo-deployment.md).
