# Future custom domain: jobs.etiennepeillard.com

Status: planning only. No DNS record, Cloudflare route, custom domain or certificate has been created or modified.

The intended final website hostname is `jobs.etiennepeillard.com`. Keep the temporary synthetic demo on its isolated workers.dev URL. By default the final hostname should be attached to the production public Worker `academic-opportunities` once release readiness, production data policies and a separate domain activation are approved. Do not point it at the disabled ingestion Worker or raw R2 bucket.

Before activation, confirm `etiennepeillard.com` is an active zone in the correct account, review existing records for `jobs` without changing them, verify ownership and hostname availability, finish production readiness checks and decide whether the temporary demo should be disabled. Do not create a placeholder A/CNAME record now.

Draft future production-only Wrangler fragment, intentionally stored **only in documentation**:

```json
{
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "jobs.etiennepeillard.com", "custom_domain": true }]
}
```

Do not merge this fragment into any active config or run a deployment with it before explicit DNS/domain approval. Custom Domain attachment causes Cloudflare to create the DNS record and certificate automatically; it is therefore a DNS-affecting action even if no separate DNS-edit command is run. An existing conflicting CNAME must be reviewed, not overwritten blindly. The future public hostname should use the same-origin API and Static Assets without any R2/Queue binding, and must not require a browser account.

When that separate change is authorized, use a token with the appropriate production Worker edit and zone Workers Routes edit permissions, scoped to the exact account/zone/Worker; any explicit DNS operations require their own DNS permission. Keep those zone permissions out of the workers.dev demo token. Validate HTTPS, deep links, security headers and the public API after activation. Keep the demo D1 and production D1 separate regardless of hostnames.

Reference: [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
