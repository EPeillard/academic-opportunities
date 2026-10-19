import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { unstable_splitSqlQuery as statements } from "wrangler";
import { SignJWT, generateKeyPair } from "jose";
import { testIdentity } from "./helpers/agent-auth.mjs";
import { handleAgentRequest } from "../apps/agent/src";
import { fixtures, pendingBatch } from "../apps/agent/src/batches";
import { receive } from "../apps/ingestion/src/intake";
import { processJob } from "../apps/ingestion/src/processing";
import { deleteMessage } from "../apps/ingestion/src/storage";
import { sha256 } from "../apps/ingestion/src/mime";
import { jobId } from "../apps/ingestion/src/types";
import { digest, iso, BATCH_TTL_MS } from "../apps/agent/src/common";
import { handleRequest } from "../apps/worker/src";
import expected from "./fixtures/agent/expected-results.json";
import { parse } from "jsonc-parser";
let mf: Miniflare, env: any, intake: any, identity: any, token: string;
const now = Date.now(),
  origin = "http://127.0.0.1:8790";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const db = async (sql: string, ...args: any[]) =>
  env.DB.prepare(sql)
    .bind(...args)
    .first<any>();
const request = (path: string, options: any = {}, at = now, target = env) =>
  handleAgentRequest(
    new Request(origin + path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    }),
    target,
    at,
  );
const get = (query = "", at = now) =>
  request("/api/agent/pending-batch" + query, {}, at);
const submit = (body: any, at = now, options: any = {}) =>
  request(
    "/api/agent/extraction-results",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      ...options,
    },
    at,
  );
const submission = (batch: any, changes = {}) => ({
  schemaVersion: 1,
  batchId: batch.batchId,
  submissionId: crypto.randomUUID(),
  results: expected.filter((r) =>
    batch.messages.some((m: any) => m.messageId === r.messageId),
  ),
  ...changes,
});
async function enroll() {
  for (const f of fixtures) {
    const bytes = new Uint8Array(
      readFileSync(new URL(`./fixtures/agent/${f.name}.eml`, import.meta.url)),
    );
    expect(await sha256(bytes)).toBe(f.messageId);
    expect(await digest(f.untrustedText)).toBe(f.textSha256);
    const reject = vi.fn();
    await receive(
      {
        raw: new ReadableStream({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
        rawSize: bytes.length,
        setReject: reject,
      },
      intake,
      now,
    );
    expect(reject).not.toHaveBeenCalled();
    await processJob(intake, jobId(f.messageId), now);
    await env.DB.prepare(
      "INSERT INTO agent_fixtures(message_id,mime_sha256,text_sha256) VALUES (?,?,?)",
    )
      .bind(f.messageId, f.messageId, f.textSha256)
      .run();
  }
}
beforeAll(async () => {
  identity = await testIdentity(origin);
  token = await identity.mint({}, {}, now);
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: "2026-06-11",
    d1Databases: { DB: "agent-local-test" },
    r2Buckets: { RAW_EMAILS: "private-agent-test" },
  });
  env = { ...identity.env, DB: await mf.getD1Database("DB") };
  intake = {
    APP_ENV: "local",
    INGESTION_ENABLED: "true",
    PROCESSING_ENABLED: "false",
    DB: env.DB,
    RAW_EMAILS: await mf.getR2Bucket("RAW_EMAILS"),
    INGESTION_QUEUE: { send: vi.fn() },
  };
  for (const name of readdirSync(
    new URL("../apps/worker/migrations", import.meta.url),
  )
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of statements(
      readFileSync(
        new URL(`../apps/worker/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    ))
      await env.DB.prepare(sql).run();
});
beforeEach(async () => {
  for (const table of [
    "agent_results",
    "agent_submissions",
    "agent_sessions",
    "agent_claims",
    "agent_batches",
    "agent_fixtures",
    "agent_rate_limits",
    "outbox",
    "jobs",
    "messages",
    "deletion_tombstones",
    "intake_admissions",
    "ingestion_maintenance",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  for (const o of (await intake.RAW_EMAILS.list()).objects)
    await intake.RAW_EMAILS.delete(o.key);
  await enroll();
});
afterAll(async () => {
  await mf?.dispose();
});

describe("OAuth resource authentication and isolated capabilities", () => {
  it("advertises public OAuth discovery without keys, subjects, tokens or message data", async () => {
    const r = await request("/.well-known/oauth-protected-resource", {
      headers: { Authorization: "" },
    });
    expect(r.status).toBe(200);
    const value = await r.json();
    expect(value).toMatchObject({
      resource: origin + "/mcp",
      authorization_servers: [identity.env.AGENT_AUTH_ISSUER],
    });
    expect(JSON.stringify(value)).not.toMatch(
      /synthetic-tester|ephemeral-local|untrustedText|keys|Bearer/,
    );
  });
  it.each([
    "",
    "Bearer invalid",
    "Basic dGVzdA==",
    "Bearer " + "x".repeat(8200),
  ])("rejects missing/invalid credentials before touching D1", async (auth) => {
    const before = await db("SELECT COUNT(*) AS n FROM agent_rate_limits");
    const r = await request("/api/agent/pending-batch", {
      headers: { Authorization: auth },
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain("resource_metadata");
    expect(await db("SELECT COUNT(*) AS n FROM agent_rate_limits")).toEqual(
      before,
    );
  });
  it.each([
    { iss: "https://wrong.example/" },
    { aud: "https://other.example/mcp" },
    { sub: "other" },
    { client_id: "other" },
    { exp: Math.floor(now / 1000) - 1 },
    { iat: Math.floor(now / 1000) + 60 },
    { nbf: Math.floor(now / 1000) + 60 },
    { iat: Math.floor(now / 1000) - 1, exp: Math.floor(now / 1000) + 7200 },
    { scope: 123 },
    { jti: "" },
  ])("rejects an invalid signed claim %j", async (change) => {
    const value = await identity.mint(change, {}, now);
    expect(
      (
        await request("/api/agent/pending-batch", {
          headers: { Authorization: `Bearer ${value}` },
        })
      ).status,
    ).toBe(401);
  });
  it("rejects attacker keys, algorithm confusion and untrusted JWT key URLs without fetching", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const fake = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "ephemeral-local" })
      .sign(privateKey);
    for (const value of [
      fake,
      await identity.mint({}, { kid: "unknown" }, now),
      await identity.mint({}, { jku: "http://169.254.169.254/" }, now),
      "eyJhbGciOiJub25lIn0.e30.",
    ])
      expect(
        (
          await request("/api/agent/pending-batch", {
            headers: { Authorization: `Bearer ${value}` },
          })
        ).status,
      ).toBe(401);
  });
  it("enforces distinct read and write scopes", async () => {
    const read = await identity.mint(
        { scope: "agent:read:synthetic" },
        {},
        now,
      ),
      write = await identity.mint({ scope: "agent:submit:synthetic" }, {}, now);
    const batch = await (await get()).json();
    const body = submission(batch);
    expect(
      (
        await submit(body, now, {
          headers: {
            Authorization: `Bearer ${read}`,
            "Content-Type": "application/json",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/agent/pending-batch", {
          headers: { Authorization: `Bearer ${write}` },
        })
      ).status,
    ).toBe(403);
  });
  it("fails closed for disabled/missing config, private JWK or unsupported environment", async () => {
    for (const values of [
      { AGENT_ENABLED: "false" },
      { AGENT_AUTH_JWKS_JSON: "{}" },
      { APP_ENV: "production" },
      {
        AGENT_AUTH_JWKS_JSON: JSON.stringify({
          keys: [{ ...identity.key, d: "private" }],
        }),
      },
      { AGENT_AUTH_SUBJECT: "" },
    ])
      expect(
        (
          await request("/api/agent/pending-batch", {}, now, {
            ...env,
            ...values,
          })
        ).status,
      ).toBe(503);
  });
  it("does not accept browser CSRF/cookies or an unexpected host/origin", async () => {
    expect(
      (
        await request("/api/agent/pending-batch", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAgentRequest(
          new Request("https://evil.example/api/agent/pending-batch", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          env,
          now,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/agent/pending-batch", {
          headers: { Authorization: "", Cookie: "auth=fake" },
        })
      ).status,
    ).toBe(401);
  });
  it("limits authenticated requests durably and sends no private output to logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (let i = 0; i < 60; i++) expect((await get()).status).toBe(200);
      const r = await get();
      expect(r.status).toBe(429);
      expect(r.headers.get("Retry-After")).toBeTruthy();
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /Bearer|Cedar|synthetic-tester|eyJ/,
      );
    } finally {
      log.mockRestore();
    }
  });
  it("never adds capabilities or agent routes to the public/demo Worker", async () => {
    const cfg = parse(
      readFileSync(
        new URL("../apps/agent/wrangler.jsonc", import.meta.url),
        "utf8",
      ),
    );
    expect(cfg.d1_databases[0].database_name).toBe(
      "academic-opportunities-agent-poc-db",
    );
    expect(cfg.d1_databases[0].remote).toBe(false);
    expect(cfg.r2_buckets).toBeUndefined();
    expect(cfg.queues).toBeUndefined();
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.triggers).toBeUndefined();
    const publicEnv = {
      DB: env.DB,
      APP_ENV: "demo",
      ASSETS: { fetch: () => new Response("app") },
    } as any;
    expect(
      (
        await handleRequest(
          new Request("https://public.example/api/agent/pending-batch"),
          publicEnv,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleRequest(
          new Request("https://public.example/api/agent/extraction-results", {
            method: "POST",
          }),
          publicEnv,
        )
      ).status,
    ).toBe(405);
  });
});

describe("synthetic batches and durable claims", () => {
  it("returns only bounded plain-text projections and stable IDs, not MIME/header/R2 references", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const result = (await response.json()) as any;
    expect(result.messages).toHaveLength(3);
    expect(
      result.messages.every(
        (m: any) => m.synthetic && m.contentType === "text/plain",
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /r2_key|mime.v1|From:|Message-ID:|synthetic@example.org/,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(((await (await get()).json()) as any).batchId).toBe(result.batchId);
  });
  it.each([
    "?limit=0",
    "?limit=4",
    "?limit=1&limit=2",
    "?cursor=wrong",
    "?admin=true",
  ])("rejects ambiguous/unbounded pagination %s", async (q) => {
    expect((await get(q)).status).toBe(400);
  });
  it("keeps active-batch parameters immutable and pages completed batches stably", async () => {
    const first = (await (await get("?limit=1")).json()) as any;
    expect((await get("?limit=2")).status).toBe(409);
    expect((await submit(submission(first))).status).toBe(200);
    const second = (await (
      await get(`?limit=1&cursor=${first.nextCursor}`)
    ).json()) as any;
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].messageId).not.toBe(first.messages[0].messageId);
  });
  it("concurrent allocation resumes one active batch without double claiming", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => get()));
    const batches = (await Promise.all(results.map((r) => r.json()))) as any[];
    expect(new Set(batches.map((b) => b.batchId)).size).toBe(1);
    expect(await db("SELECT COUNT(*) AS n FROM agent_claims")).toMatchObject({
      n: 3,
    });
  });
  it("cannot export an unknown or real receipt even if accidentally enrolled", async () => {
    const bytes = new TextEncoder().encode(
      "From: real@example.org\r\nContent-Type: text/plain\r\n\r\nPRIVATE REAL EMAIL",
    );
    const hash = await sha256(bytes);
    await receive(
      {
        raw: new ReadableStream({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
        rawSize: bytes.length,
        setReject: vi.fn(),
      },
      intake,
      now,
    );
    await processJob(intake, jobId(hash), now);
    await env.DB.prepare(
      "INSERT INTO agent_fixtures(message_id,mime_sha256,text_sha256) VALUES (?,?,?)",
    )
      .bind(hash, hash, fixtures[0].textSha256)
      .run();
    const batch = (await (await get()).json()) as any;
    expect(batch.messages).toHaveLength(3);
    expect(JSON.stringify(batch)).not.toMatch(/PRIVATE REAL|real@example.org/);
    expect(batch.messages.some((m: any) => m.messageId === hash)).toBe(false);
  });
  it("requires successful M2 processing, enrollment and no suppression", async () => {
    await env.DB.prepare("UPDATE jobs SET state='failed' WHERE message_id=?")
      .bind(fixtures[0].messageId)
      .run();
    await deleteMessage(intake, fixtures[1].messageId, now);
    expect(
      ((await (await get()).json()) as any).messages.map(
        (m: any) => m.messageId,
      ),
    ).toEqual([fixtures[2].messageId]);
  });
  it("expired claims can be reassigned, but the old batch cannot submit", async () => {
    const first = (await (await get()).json()) as any;
    const later = now + BATCH_TTL_MS + 1;
    const refreshed = await identity.mint({}, {}, later);
    const next = (await (
      await request(
        "/api/agent/pending-batch",
        { headers: { Authorization: `Bearer ${refreshed}` } },
        later,
      )
    ).json()) as any;
    expect(next.batchId).not.toBe(first.batchId);
    expect(
      (
        await submit(submission(first), later, {
          headers: {
            Authorization: `Bearer ${refreshed}`,
            "Content-Type": "application/json",
          },
        })
      ).status,
    ).toBe(410);
  });
  it("binds a batch to its validated principal, not caller-supplied IDs", async () => {
    const batch = (await (await get()).json()) as any;
    const other = await identity.mint({ sub: "other-approved-user" }, {}, now);
    const r = await request(
      "/api/agent/extraction-results",
      {
        method: "POST",
        body: JSON.stringify(submission(batch)),
        headers: {
          Authorization: `Bearer ${other}`,
          "Content-Type": "application/json",
        },
      },
      now,
      { ...env, AGENT_AUTH_SUBJECT: "other-approved-user" },
    );
    expect(r.status).toBe(404);
    expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject({
      n: 0,
    });
  });
});

describe("strict private extraction submissions", () => {
  it("stores zero, one and multiple candidates without public opportunity writes or M2 state changes", async () => {
    const before = await db("SELECT SUM(attempt_count) AS n FROM jobs");
    const batch = (await (await get()).json()) as any;
    const body = submission(batch);
    const r = await submit(body);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      batchId: batch.batchId,
      submissionId: body.submissionId,
      messageCount: 3,
      state: "pending_validation",
    });
    const results = (
      await env.DB.prepare("SELECT payload_json,state FROM agent_results").all()
    ).results;
    expect(
      results
        .map((r: any) => JSON.parse(r.payload_json).candidates.length)
        .sort(),
    ).toEqual([0, 1, 2]);
    expect(results.every((r: any) => r.state === "pending_validation")).toBe(
      true,
    );
    expect(await db("SELECT COUNT(*) AS n FROM opportunities")).toMatchObject({
      n: 0,
    });
    expect(await db("SELECT SUM(attempt_count) AS n FROM jobs")).toEqual(
      before,
    );
    expect(((await (await get()).json()) as any).messages).toEqual([]);
    expect(
      JSON.parse(
        results.find(
          (r: any) => JSON.parse(r.payload_json).candidates.length === 1,
        ).payload_json,
      ).candidates[0].fields.compensation,
    ).toBeNull();
  });
  it("exact canonical replay and concurrent identical submissions have one receipt and effect", async () => {
    const batch = (await (await get()).json()) as any,
      body = submission(batch);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => submit(body)),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const receipts = await Promise.all(responses.map((r) => r.json()));
    expect(
      receipts.every((r) => JSON.stringify(r) === JSON.stringify(receipts[0])),
    ).toBe(true);
    expect(
      await db("SELECT COUNT(*) AS n FROM agent_submissions"),
    ).toMatchObject({ n: 1 });
    expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject({
      n: 3,
    });
    const replay = { ...body, results: [...body.results].reverse() };
    expect((await submit(replay)).status).toBe(200);
  });
  it("rejects changed replay and a reused batch or submission identifier", async () => {
    const batch = (await (await get()).json()) as any,
      body = submission(batch);
    await submit(body);
    expect(
      (await submit({ ...body, submissionId: crypto.randomUUID() })).status,
    ).toBe(409);
    const changed = clone(body);
    changed.results[1].candidates = [];
    expect((await submit(changed)).status).toBe(409);
  });
  it.each([
    "unknown-field",
    "publication",
    "bad-url",
    "bad-type",
    "missing-null",
    "extra-message",
    "duplicate-message",
    "bad-quote",
    "missing-evidence",
  ])("rejects %s without partial writes", async (kind) => {
    const batch = (await (await get()).json()) as any,
      body: any = clone(submission(batch));
    const populated = body.results.find((r: any) => r.candidates.length)
      .candidates[0];
    if (kind === "unknown-field") body.token = "secret";
    if (kind === "publication") populated.fields.state = "published";
    if (kind === "bad-url")
      populated.fields.applicationUrl = "http://169.254.169.254/metadata";
    if (kind === "bad-type") populated.fields.jobType = "Wizard";
    if (kind === "missing-null") delete populated.fields.compensation;
    if (kind === "extra-message") body.results[0].messageId = "f".repeat(64);
    if (kind === "duplicate-message") body.results[0] = body.results[1];
    if (kind === "bad-quote") populated.evidence[0].quote = "invented";
    if (kind === "missing-evidence") populated.evidence = [];
    expect((await submit(body)).status).toBe(400);
    expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject({
      n: 0,
    });
  });
  it("requires complete batch membership and enforces byte/content-type limits", async () => {
    const batch = (await (await get()).json()) as any,
      body = submission(batch);
    expect(
      (await submit({ ...body, results: body.results.slice(1) })).status,
    ).toBe(400);
    expect(
      (
        await request("/api/agent/extraction-results", {
          method: "POST",
          body: "x".repeat(65537),
          headers: { "Content-Type": "application/json" },
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request("/api/agent/extraction-results", {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await request("/api/agent/extraction-results", {
          method: "POST",
          body: "{",
          headers: { "Content-Type": "application/json" },
        })
      ).status,
    ).toBe(400);
  });
  it("M2 deletion erases bridge results and blocks replay/resurrection", async () => {
    const batch = (await (await get()).json()) as any,
      body = submission(batch);
    await submit(body);
    await deleteMessage(intake, fixtures[0].messageId, now);
    expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject({
      n: 2,
    });
    expect((await submit(body)).status).toBe(410);
    expect(((await (await get()).json()) as any).messages).toEqual([]);
  });
  it("suppression just before the commit blocks every result atomically", async () => {
    const batch = (await (await get()).json()) as any,
      body = submission(batch);
    let once = true;
    const database = new Proxy(env.DB, {
      get(t, k) {
        if (k === "batch")
          return async (statements: any) => {
            if (once) {
              once = false;
              await deleteMessage(intake, fixtures[0].messageId, now);
            }
            return t.batch(statements);
          };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    expect(
      (
        await request(
          "/api/agent/extraction-results",
          {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          },
          now,
          { ...env, DB: database },
        )
      ).status,
    ).toBe(409);
    expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject({
      n: 0,
    });
  });
  it("D1 failure is generic and leaves no accepted partial submission", async () => {
    const batch = (await (await get()).json()) as any,
      body = submission(batch);
    const database = new Proxy(env.DB, {
      get(t, k) {
        if (k === "batch")
          return () => {
            throw new Error("PRIVATE TOKEN body@example.org");
          };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const r = await request(
        "/api/agent/extraction-results",
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        },
        now,
        { ...env, DB: database },
      );
      expect(r.status).toBe(503);
      expect(await r.text()).not.toMatch(/PRIVATE|body@/);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|body@/);
      expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject(
        { n: 0 },
      );
    } finally {
      log.mockRestore();
    }
  });
});

describe("MCP contract and additional commit boundaries", () => {
  const rpc = (value: any, authorization = token) =>
    request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${authorization}`,
      },
      body: JSON.stringify(value),
    });
  it("advertises exactly two scoped write tools and rejects unknown calls", async () => {
    const listing = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(listing.status).toBe(200);
    const body = (await listing.json()) as any;
    expect(body.result.tools).toHaveLength(2);
    for (const tool of body.result.tools) {
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.securitySchemes[0].type).toBe("oauth2");
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
    }
    const unknown = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "fetch_url",
        arguments: { url: "http://169.254.169.254/" },
      },
    });
    expect(((await unknown.json()) as any).result.isError).toBe(true);
  });
  it("requires scoped OAuth on calls and exposes a reauthorization challenge", async () => {
    const readonly = await identity.mint(
      { scope: "agent:read:synthetic" },
      {},
      now,
    );
    const batch = (await (await get()).json()) as any;
    const r = await rpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "submit_synthetic_extraction_results",
          arguments: submission(batch),
        },
      },
      readonly,
    );
    const result = ((await r.json()) as any).result;
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain(
      "insufficient_scope",
    );
    expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject({
      n: 0,
    });
  });
  it("rejects batched RPC amplification and unexpected methods with fixed limits", async () => {
    expect(
      (await rpc([{ jsonrpc: "2.0", id: 1, method: "tools/list" }])).status,
    ).toBe(400);
    expect((await request("/mcp")).status).toBe(405);
  });
  it("rolls back a failure in a later result insertion, including submission acceptance", async () => {
    const batch = (await (await get()).json()) as any;
    await env.DB.prepare(
      "CREATE TRIGGER agent_fail_result BEFORE INSERT ON agent_results BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    ).run();
    try {
      expect((await submit(submission(batch))).status).toBe(503);
      expect(
        await db("SELECT COUNT(*) AS n FROM agent_submissions"),
      ).toMatchObject({ n: 0 });
      expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject(
        { n: 0 },
      );
      expect(
        await db(
          "SELECT COUNT(*) AS n FROM agent_claims WHERE state='pending'",
        ),
      ).toMatchObject({ n: 3 });
    } finally {
      await env.DB.prepare("DROP TRIGGER agent_fail_result").run();
    }
  });
  it("canonicalizes object-key order but rejects a reused submission ID in another batch", async () => {
    const batch = (await (await get("?limit=1")).json()) as any,
      body = submission(batch);
    await submit(body);
    const reordered = {
      results: body.results,
      submissionId: body.submissionId,
      batchId: body.batchId,
      schemaVersion: 1,
    };
    expect((await submit(reordered)).status).toBe(200);
    const next = (await (await get("?limit=1")).json()) as any;
    expect(
      (await submit(submission(next, { submissionId: body.submissionId })))
        .status,
    ).toBe(409);
  });
  it("tombstone insertion alone suppresses the bridge before a message status update", async () => {
    const batch = (await (await get()).json()) as any,
      body = submission(batch);
    await submit(body);
    await env.DB.prepare(
      "INSERT INTO deletion_tombstones(content_sha256,deleted_at,expires_at) VALUES (?,?,?)",
    )
      .bind(fixtures[0].messageId, iso(now), "9999-12-31T23:59:59.999Z")
      .run();
    expect((await submit(body)).status).toBe(410);
    expect(await db("SELECT COUNT(*) AS n FROM agent_results")).toMatchObject({
      n: 2,
    });
  });
});
