import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
const base = "http://127.0.0.1:8799";
const child = spawn(
  process.execPath,
  [
    "../../node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    "8799",
    "--inspector-port",
    "0",
  ],
  {
    cwd: new URL("../apps/worker/", import.meta.url),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) throw new Error(`Worker exited: ${output}`);
    try {
      const r = await fetch(base + "/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  assert.ok(ready, `Worker did not start: ${output}`);
  const response = await fetch(base + "/api/opportunities");
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.equal(list.total, 8);
  assert.equal(list.items.length, 8);
  const filtered = await (
    await fetch(base + "/api/opportunities?type=Internship&country=France")
  ).json();
  assert.equal(filtered.total, 1);
  const detail = await fetch(base + "/api/opportunities/" + list.items[0].id);
  assert.equal(detail.status, 200);
  assert.equal(
    (await fetch(base + "/api/opportunities/private-review")).status,
    404,
  );
  assert.equal((await fetch(base + "/admin")).status, 403);
  assert.equal((await fetch(base + "/api/raw")).status, 404);
  for (const path of ["/", "/opportunities/" + list.items[0].id]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    const html = await r.text();
    assert.match(html, /<div id="root"><\/div>/);
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    assert.equal((await fetch(base + asset)).status, 200);
    assert.match(
      r.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
  }
  console.log(
    "Local Wrangler HTTP smoke passed: seeded D1, filters, details, private denial, SPA deep links and asset serving.",
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    pause(3000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
