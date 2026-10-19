// Protocol rehearsal only: no ChatGPT task, paid LLM API, deployed resource or OAuth login.
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery as statements } from "wrangler";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
import { testIdentity } from "../tests/helpers/agent-auth.mjs";
const fixtures = JSON.parse(
  readFileSync(new URL("../apps/agent/src/fixtures.json", import.meta.url)),
);
const expected = JSON.parse(
  readFileSync(
    new URL("../tests/fixtures/agent/expected-results.json", import.meta.url),
  ),
);
const identity = await testIdentity(),
  token = await identity.mint();
const mf = new Miniflare({
  unsafeTriggerHandlers: true,
  outboundService: () => {
    throw new Error("Unexpected outbound HTTP in synthetic bridge rehearsal");
  },
  workers: [
    {
      name: "intake",
      modules: true,
      scriptPath: fileURLToPath(
        new URL("../apps/ingestion/dist/index.js", import.meta.url),
      ),
      compatibilityDate: "2026-06-11",
      bindings: {
        APP_ENV: "local",
        INGESTION_ENABLED: "true",
        PROCESSING_ENABLED: "true",
      },
      d1Databases: { DB: "agent-smoke-db" },
      r2Buckets: { RAW_EMAILS: "agent-smoke-private" },
      queueProducers: { INGESTION_QUEUE: "agent-smoke-queue" },
      queueConsumers: {
        "agent-smoke-queue": {
          maxBatchSize: 3,
          maxBatchTimeout: 0,
          maxRetries: 3,
        },
      },
    },
    {
      name: "agent",
      modules: true,
      scriptPath: fileURLToPath(
        new URL("../apps/agent/dist/index.js", import.meta.url),
      ),
      compatibilityDate: "2026-06-11",
      bindings: identity.env,
      d1Databases: { DB: "agent-smoke-db" },
    },
  ],
});
const client = new Client({
  name: "synthetic-poc-rehearsal",
  version: "0.1.0",
});
try {
  const db = await mf.getD1Database("DB", "agent");
  for (const name of readdirSync(
    new URL("../apps/worker/migrations/", import.meta.url),
  )
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of statements(
      readFileSync(
        new URL(`../apps/worker/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    ))
      await db.prepare(sql).run();
  for (const f of fixtures) {
    const raw = readFileSync(
      new URL(`../tests/fixtures/agent/${f.name}.eml`, import.meta.url),
    );
    const response = await mf.dispatchFetch(
      "http://localhost/cdn-cgi/handler/email?from=synthetic@example.org&to=poc@example.org",
      { method: "POST", body: raw },
    );
    assert.equal(response.status, 200);
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='succeeded'")
          .first()
      ).n === 3
    ) {
      ready = true;
      break;
    }
    await pause(100);
  }
  assert.ok(ready, "M2 synthetic integrity work did not finish");
  for (const f of fixtures)
    await db
      .prepare(
        "INSERT INTO agent_fixtures(message_id,mime_sha256,text_sha256) VALUES (?,?,?)",
      )
      .bind(f.messageId, f.messageId, f.textSha256)
      .run();
  const worker = await mf.getWorker("agent");
  assert.equal(
    (await worker.fetch("http://127.0.0.1:8790/api/agent/pending-batch"))
      .status,
    401,
  );
  const discovery = await worker.fetch(
    "http://127.0.0.1:8790/.well-known/oauth-protected-resource",
  );
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).resource, identity.env.AGENT_RESOURCE);
  const transport = new StreamableHTTPClientTransport(
    new URL(identity.env.AGENT_RESOURCE),
    {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => {
        const r = new Request(input, init);
        return worker.fetch(r.url, {
          method: r.method,
          headers: Object.fromEntries(r.headers),
          ...(r.method === "POST" ? { body: await r.arrayBuffer() } : {}),
        });
      },
    },
  );
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 2);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint === false));
  assert.ok(
    tools.every((t) => t._meta?.securitySchemes?.[0]?.type === "oauth2"),
  );
  // The generic SDK strips non-standard top-level tool keys on decode;
  // inspect the wire response as well as its backwards-compatible _meta mirror.
  const wire = await worker.fetch(identity.env.AGENT_RESOURCE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/list",
      params: {},
    }),
  });
  assert.equal(wire.status, 200);
  assert.ok(
    (await wire.json()).result.tools.every(
      (t) => t.securitySchemes?.[0]?.type === "oauth2",
    ),
  );
  const result = await client.callTool({
    name: "get_pending_synthetic_batch",
    arguments: { limit: 3 },
  });
  assert.ok(!result.isError, JSON.stringify(result));
  const batch = result.structuredContent;
  assert.equal(batch.messages.length, 3);
  assert.ok(batch.messages.every((m) => m.synthetic));
  assert.doesNotMatch(JSON.stringify(batch), /Message-ID:|r2_key|mime\/v1/);
  const body = {
    schemaVersion: 1,
    batchId: batch.batchId,
    submissionId: crypto.randomUUID(),
    results: expected,
  };
  const saved = await client.callTool({
    name: "submit_synthetic_extraction_results",
    arguments: body,
  });
  assert.ok(!saved.isError, JSON.stringify(saved));
  assert.equal(saved.structuredContent.state, "pending_validation");
  const replay = await client.callTool({
    name: "submit_synthetic_extraction_results",
    arguments: body,
  });
  assert.deepEqual(replay.structuredContent, saved.structuredContent);
  const rest = await worker.fetch(
    "http://127.0.0.1:8790/api/agent/pending-batch",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(rest.status, 200);
  assert.deepEqual((await rest.json()).messages, []);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM agent_results WHERE state='pending_validation'",
        )
        .first()
    ).n,
    3,
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM opportunities").first()).n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE state='succeeded' AND attempt_count=1",
        )
        .first()
    ).n,
    3,
  );
  console.log(
    "Local M2.5 protocol rehearsal passed: real M2 intake/R2/Queue, isolated Worker OAuth JWT checks, SDK MCP initialize/discovery/calls, REST, replay safety and zero publication. No ChatGPT/OAuth linking/scheduled run was tested.",
  );
} finally {
  await client.close();
  await mf.dispose();
}
