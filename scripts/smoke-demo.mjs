// Fully local deployment rehearsal. Never invokes a remote D1 command or deploy.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
import { createDemoConfig } from "./demo-environment.mjs";
const state = mkdtempSync(join(tmpdir(), "academic-demo-"));
const cwd = fileURLToPath(new URL("../apps/worker/", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const configPath = join(cwd, `wrangler.demo.smoke-${process.pid}.jsonc`);
const config = createDemoConfig({
  accountId: "a".repeat(32),
  databaseId: "12345678-1234-4234-8234-123456789abc",
});
const environment = { ...process.env, WRANGLER_SEND_METRICS: "false" };
delete environment.CLOUDFLARE_API_TOKEN;
writeFileSync(configPath, JSON.stringify(config));
const args = ["--config", configPath, "--local", "--persist-to", state];
const run = (more) =>
  execFileSync(process.execPath, [wrangler, ...more, ...args], {
    cwd,
    env: environment,
    stdio: "pipe",
  });
let child,
  output = "";
try {
  run(["d1", "migrations", "apply", "DB"]);
  // Same committed synthetic fixture, with idempotent reapplication.
  for (let i = 0; i < 2; i++)
    run(["d1", "execute", "DB", "--file", "seeds/synthetic.sql"]);
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      ...args,
      "--ip",
      "127.0.0.1",
      "--port",
      "8798",
      "--inspector-port",
      "0",
    ],
    { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  const base = "http://127.0.0.1:8798";
  let ready = false;
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null)
      throw new Error(`Local demo Worker exited: ${output}`);
    try {
      if (
        (
          await fetch(base + "/api/health", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  assert.ok(ready, `Local demo Worker failed to start: ${output}`);
  const result = await (await fetch(base + "/api/opportunities")).json();
  assert.equal(result.total, 8);
  assert.ok(result.items.every((o) => o.synthetic === true));
  assert.equal(
    (
      await fetch(
        base + "/api/opportunities?type=Internship&country=France",
      ).then((r) => r.json())
    ).total,
    1,
  );
  assert.equal(
    (await fetch(base + "/api/opportunities/" + result.items[0].id)).status,
    200,
  );
  assert.equal(
    (await fetch(base + "/api/opportunities/private-review")).status,
    404,
  );
  assert.equal(
    (await fetch(base + "/api/opportunities", { method: "POST" })).status,
    405,
  );
  assert.equal((await fetch(base + "/api/admin")).status, 403);
  assert.equal((await fetch(base + "/api/raw-mails")).status, 404);
  for (const path of ["/", "/opportunities/" + result.items[0].id]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<div id="root"><\/div>/);
    assert.match(r.headers.get("content-security-policy"), /object-src 'none'/);
    assert.equal(
      (await fetch(base + html.match(/src="([^"]+\.js)"/)[1])).status,
      200,
    );
  }
  console.log(
    "Isolated local demo smoke passed: migrations, repeated synthetic seed, read-only API, filters, details, private denials and static assets. No Cloudflare deployment was run.",
  );
} finally {
  if (child) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      pause(3000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  unlinkSync(configPath);
  rmSync(state, { recursive: true, force: true });
}
