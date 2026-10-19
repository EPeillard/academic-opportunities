// Local workerd only: this does not configure Auth0, expose HTTPS or call ChatGPT.
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery as statements } from "wrangler";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { testIdentity } from "../tests/helpers/agent-auth.mjs";
import { createConfig, root } from "./agent-poc-environment.mjs";
import { fixtureSql } from "./agent-poc-fixtures.mjs";
import { probe, verifyStored } from "./verify-agent-poc.mjs";
const identity = await testIdentity(
  "https://academic-opportunities-agent-poc.synthetic-test.workers.dev",
);
const config = createConfig({
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_AGENT_POC_D1_DATABASE_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  AGENT_RESOURCE: identity.env.AGENT_RESOURCE,
  AGENT_AUTH_ISSUER: "https://isolated-poc.eu.auth0.com/",
  AGENT_AUTH_SUBJECT: "auth0|synthetic-approved",
  AGENT_AUTH_CLIENT_ID: "predefined-client",
  AGENT_AUTH_JWKS_JSON: JSON.stringify({ keys: [identity.key] }),
  AGENT_TEST_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
});
Object.assign(identity.env, config.vars, { AGENT_ENABLED: "true" });
const token = await identity.mint();
const temporary = mkdtempSync(join(tmpdir(), "agent-poc-dry-run-"));
const temporaryConfig = join(
  root,
  `apps/agent/wrangler.poc-rehearsal-${crypto.randomUUID()}.jsonc`,
);
let mf,
  client,
  server,
  configWritten = false;
try {
  // This file never contains private keys/tokens; do not overwrite operator configuration.
  writeFileSync(temporaryConfig, JSON.stringify(config), {
    mode: 0o600,
    flag: "wx",
  });
  configWritten = true;
  const cleanEnv = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  delete cleanEnv.CLOUDFLARE_API_TOKEN;
  delete cleanEnv.CLOUDFLARE_API_KEY;
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/wrangler/bin/wrangler.js"),
      "deploy",
      "--config",
      temporaryConfig,
      "--dry-run",
      "--outdir",
      temporary,
    ],
    { cwd: root, env: cleanEnv, stdio: "pipe" },
  );
  mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(
      new URL("../apps/agent/dist/index.js", import.meta.url),
    ),
    compatibilityDate: "2026-06-11",
    bindings: identity.env,
    d1Databases: { DB: "synthetic-poc-live-profile" },
    outboundService: () => {
      throw new Error("Outbound HTTP forbidden in local PoC rehearsal");
    },
  });
  const db = await mf.getD1Database("DB");
  for (const f of readdirSync(
    new URL("../apps/worker/migrations/", import.meta.url),
  )
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.batch(
      statements(
        readFileSync(
          new URL("../apps/worker/migrations/" + f, import.meta.url),
          "utf8",
        ),
      ).map((s) => db.prepare(s)),
    );
  for (let i = 0; i < 2; i++)
    await db.batch(statements(fixtureSql()).map((s) => db.prepare(s)));
  const request = async (input, init) => {
    const r = new Request(input, init);
    return mf.dispatchFetch(r.url, {
      method: r.method,
      headers: Object.fromEntries(r.headers),
      ...(r.method === "POST" ? { body: await r.arrayBuffer() } : {}),
    });
  };
  assert.ok((await probe(config, request)).extraRoutesClosed);
  client = new Client({
    name: "synthetic-live-profile-rehearsal",
    version: "0.1.0",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(config.vars.AGENT_RESOURCE), {
      fetch: request,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  assert.equal((await client.listTools()).tools.length, 2);
  const batch = await client.callTool({
    name: "get_pending_synthetic_batch",
    arguments: { limit: 3 },
  });
  assert.ok(!batch.isError);
  assert.equal(batch.structuredContent.messages.length, 3);
  const expected = JSON.parse(
    readFileSync(
      new URL("../tests/fixtures/agent/expected-results.json", import.meta.url),
      "utf8",
    ),
  );
  const body = {
    schemaVersion: 1,
    batchId: batch.structuredContent.batchId,
    submissionId: crypto.randomUUID(),
    results: expected,
  };
  const saved = await client.callTool({
    name: "submit_synthetic_extraction_results",
    arguments: body,
  });
  assert.ok(!saved.isError);
  const replay = await client.callTool({
    name: "submit_synthetic_extraction_results",
    arguments: body,
  });
  assert.deepEqual(replay.structuredContent, saved.structuredContent);
  server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  const contracts = await server.ssrLoadModule("/apps/agent/src/contracts.ts");
  const report = await verifyStored(
    config,
    async (sql) => (await db.prepare(sql).all()).results,
    contracts,
  );
  assert.equal(report.messageCount, 3);
  assert.equal(report.publicationCount, 0);
  console.log(
    "Local live-profile rehearsal passed: generated config dry-run, synthetic bootstrap twice, MCP-only OAuth JWT checks, SDK calls/replay and private D1 verification. Auth0 login and ChatGPT extraction were NOT tested.",
  );
} finally {
  await client?.close();
  await server?.close();
  await mf?.dispose();
  if (configWritten) rmSync(temporaryConfig, { force: true });
  rmSync(temporary, { recursive: true, force: true });
}
