// Manual, read-only inventory. Never fetches mail, database rows, stored objects,
// Worker code or secret values. Every Cloudflare request uses GET.
import { writeFile } from "node:fs/promises";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token)
  throw new Error("Cloudflare account and token are required.");
const prefix = /^academic-opportunities(?:-|$)/;
const checks = [];
async function read(label, path) {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    const body = await response.json();
    if (!response.ok || !body.success) {
      checks.push({
        resource: label,
        status: "unavailable",
        httpStatus: response.status,
      });
      return null;
    }
    return body;
  } catch {
    checks.push({
      resource: label,
      status: "unavailable",
      reason: "Request failed",
    });
    return null;
  }
}
async function list(label, path) {
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const body = await read(label, `${path}?page=${page}&per_page=100`);
    if (!body) return null;
    if (!Array.isArray(body.result)) {
      checks.push({
        resource: label,
        status: "unavailable",
        reason: "Unexpected response shape",
      });
      return null;
    }
    items.push(...body.result);
    if (
      !body.result.length ||
      (body.result_info?.total_pages && page >= body.result_info.total_pages) ||
      (!body.result_info?.total_pages && body.result.length < 100)
    )
      return items;
  }
  checks.push({
    resource: label,
    status: "incomplete",
    reason: "Pagination limit",
  });
  return null;
}
const base = `/accounts/${encodeURIComponent(account)}`;
const scripts = await list("workers", `${base}/workers/scripts`);
const workers = [];
for (const script of scripts?.filter((s) => prefix.test(s.id)) ?? []) {
  const path = `${base}/workers/scripts/${encodeURIComponent(script.id)}`;
  const settings = await read(`bindings:${script.id}`, `${path}/settings`);
  const schedule = await read(`schedules:${script.id}`, `${path}/schedules`);
  workers.push({
    name: script.id,
    bindings: settings
      ? (settings.result.bindings ?? []).map((b) => ({
          name: b.name,
          type: b.type,
        }))
      : null,
    cron: schedule
      ? (schedule.result.schedules ?? []).map((s) => s.cron)
      : null,
  });
}
const databases = await list("d1", `${base}/d1/database`);
const buckets = await read("r2", `${base}/r2/buckets`);
const queues = await list("queues", `${base}/queues`);
const domains = await list("worker_domains", `${base}/workers/domains`);
const emailRules = await list(
  "account_email_routing",
  `${base}/email/routing/rules`,
);
const report = {
  checkedAt: new Date().toISOString(),
  workers: scripts ? workers : null,
  d1:
    databases
      ?.filter((d) => prefix.test(d.name))
      .map((d) => ({ name: d.name })) ?? null,
  r2: buckets
    ? (buckets.result.buckets ?? [])
        .filter((b) => prefix.test(b.name))
        .map((b) => ({ name: b.name }))
    : null,
  queues:
    queues
      ?.filter((q) => prefix.test(q.queue_name))
      .map((q) => ({
        name: q.queue_name,
        consumers: (q.consumers ?? []).map((c) => ({
          type: c.type,
          worker: c.script_name ?? null,
        })),
      })) ?? null,
  domains:
    domains
      ?.filter((d) => prefix.test(d.service ?? ""))
      .map((d) => ({ hostname: d.hostname, worker: d.service })) ?? null,
  emailRules:
    emailRules?.flatMap((r) => {
      const targets = (r.actions ?? [])
        .filter((a) => a.type === "worker")
        .flatMap((a) => a.value ?? [])
        .filter((v) => prefix.test(v));
      return targets.length
        ? [{ id: r.tag ?? r.id, enabled: r.enabled, workers: targets }]
        : [];
    }) ?? null,
  checks,
  limits: [
    "Only project-prefixed resources are listed.",
    "No database contents or stored emails were inspected.",
    "Zone-level email rules, external forwarding, DNS records and third-party OAuth connections require separate verification.",
  ],
};
await writeFile(
  "cloudflare-audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
