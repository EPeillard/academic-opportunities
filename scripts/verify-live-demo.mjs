import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { ListSchema, OpportunitySchema } from "../packages/shared/src/index.ts";

export function demoUrl(subdomain) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain ?? ""))
    throw new Error(
      "Set CLOUDFLARE_WORKERS_SUBDOMAIN to the account subdomain only, without a URL or .workers.dev.",
    );
  return `https://academic-opportunities-demo.${subdomain}.workers.dev`;
}
export async function verifyLiveDemo(
  baseUrl,
  { request = fetch, wait = pause } = {},
) {
  const url = new URL(baseUrl);
  assert.match(
    url.hostname,
    /^academic-opportunities-demo\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/,
  );
  assert.equal(url.protocol, "https:");
  assert.equal(url.port, "");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.pathname, "/");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  const base = url.origin;
  const get = (path, method = "GET") =>
    request(base + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  let ready = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if ((await get("/api/health")).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await wait(2000);
  }
  assert.ok(ready, "Public demo did not become available.");
  const listResponse = await get("/api/opportunities");
  assert.equal(listResponse.status, 200);
  const list = ListSchema.parse(await listResponse.json());
  assert.equal(list.total, 8);
  assert.equal(list.items.length, 8);
  assert.ok(list.items.every((o) => o.synthetic === true));
  assert.equal(new Set(list.items.map((o) => o.id)).size, 8);
  const filtered = await get(
    "/api/opportunities?type=Internship&country=France",
  );
  assert.equal(filtered.status, 200);
  const selection = ListSchema.parse(await filtered.json());
  assert.equal(selection.total, 1);
  assert.equal(selection.items[0].jobType, "Internship");
  assert.equal(selection.items[0].country, "France");
  const detail = await get("/api/opportunities/phd-embodied-ai");
  assert.equal(detail.status, 200);
  assert.equal(OpportunitySchema.parse(await detail.json()).synthetic, true);
  for (const [path, status, method] of [
    ["/api/opportunities/private-review", 404, "GET"],
    ["/api/admin", 403, "GET"],
    ["/api/raw-mails", 404, "GET"],
    ["/api/opportunities", 405, "POST"],
  ])
    assert.equal(
      (await get(path, method)).status,
      status,
      `Unexpected status for ${path}`,
    );
  for (const path of ["/", "/opportunities/phd-embodied-ai"]) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /object-src 'none'/,
    );
    const html = await response.text();
    assert.match(html, /<div id="root"><\/div>/);
    const asset = html.match(/src="([^"\s]+\.js)"/)?.[1];
    assert.ok(
      asset?.startsWith("/assets/"),
      "Expected same-origin built JavaScript asset",
    );
    const assetUrl = new URL(asset, base);
    assert.equal(assetUrl.origin, base);
    assert.equal((await get(assetUrl.pathname)).status, 200);
  }
  return base;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const base = demoUrl(process.env.CLOUDFLARE_WORKERS_SUBDOMAIN);
    await verifyLiveDemo(base);
    console.log(`Verified public demo: ${base}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Verified synthetic demo\n\n[Open demo](${base})\n\nWebsite/assets, eight synthetic public opportunities, filters, details, and private/write denials passed.\n\nReal-browser visual review remains manual.\n`,
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
