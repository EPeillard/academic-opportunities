import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { unstable_splitSqlQuery as statements } from "wrangler";
import { testIdentity } from "./helpers/agent-auth.mjs";
import { handleAgentRequest } from "../apps/agent/src";
import { pendingBatch, submitResults } from "../apps/agent/src/batches";
import { digest, type AgentEnv } from "../apps/agent/src/common";
import * as contracts from "../apps/agent/src/contracts";
import { fixtureSql, fixtureManifest } from "../scripts/agent-poc-fixtures.mjs";
import {
  createConfig,
  validateConfig,
  verifyIdentity,
  runAction,
  actionArgs,
  checkOAuth,
  DATABASE,
} from "../scripts/agent-poc-environment.mjs";
import { verifyStored, probe } from "../scripts/verify-agent-poc.mjs";
const restriction = createRequire(import.meta.url)(
  "../integrations/auth0/restrict-synthetic-poc.cjs",
);
const expected = JSON.parse(
  readFileSync(
    new URL("./fixtures/agent/expected-results.json", import.meta.url),
    "utf8",
  ),
);
let identity: any, config: any;
const now = Date.now();
beforeAll(async () => {
  identity = await testIdentity(
    "https://academic-opportunities-agent-poc.synthetic-test.workers.dev",
  );
  config = createConfig(
    {
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_AGENT_POC_D1_DATABASE_ID:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      AGENT_RESOURCE: identity.env.AGENT_RESOURCE,
      AGENT_AUTH_ISSUER: "https://isolated-poc.eu.auth0.com/",
      AGENT_AUTH_SUBJECT: "auth0|approved",
      AGENT_AUTH_CLIENT_ID: "provided-client",
      AGENT_AUTH_JWKS_JSON: JSON.stringify({ keys: [identity.key] }),
      AGENT_TEST_EXPIRES_AT: new Date(now + 3600000).toISOString(),
    },
    now,
  );
  Object.assign(identity.env, config.vars, { AGENT_ENABLED: "true" });
});
describe("live PoC configuration and remote guards", () => {
  it("defaults disabled, contains only isolated DB, HTTPS MCP origin and expiry", () => {
    expect(config.vars.AGENT_ENABLED).toBe("false");
    expect(config.name).toBe("academic-opportunities-agent-poc");
    expect(config.d1_databases[0].database_name).toBe(DATABASE);
    expect(validateConfig(config, [], now)).toEqual(config);
  });
  it.each([
    (c: any) => (c.d1_databases[0].database_name = "academic-opportunities-db"),
    (c: any) => (c.name = "academic-opportunities-demo"),
    (c: any) => (c.r2_buckets = []),
    (c: any) => (c.services = []),
    (c: any) => (c.assets = {}),
    (c: any) => (c.routes = ["jobs.etiennepeillard.com/*"]),
    (c: any) => (c.triggers.crons = ["* * * * *"]),
    (c: any) => (c.vars.APP_ENV = "production"),
    (c: any) => (c.preview_urls = true),
    (c: any) =>
      (c.vars.AGENT_RESOURCE =
        "https://academic-opportunities-demo.etienne-peillard.workers.dev/mcp"),
    (c: any) => (c.vars.AGENT_RESOURCE += "?secret=bad"),
    (c: any) => (c.vars.AGENT_AUTH_ISSUER = "https://auth0.com.evil.example/"),
    (c: any) =>
      (c.vars.AGENT_TEST_EXPIRES_AT = new Date(
        now + 8 * 86400000,
      ).toISOString()),
    (c: any) =>
      (c.vars.AGENT_AUTH_JWKS_JSON = JSON.stringify({
        keys: [{ ...identity.key, d: "private" }],
      })),
  ])("rejects unsafe configuration %#", (mutate) => {
    const c = structuredClone(config);
    mutate(c);
    expect(() => validateConfig(c, [], now)).toThrow();
  });
  it("blocks known production/demo UUID even with correct PoC name", () =>
    expect(() =>
      validateConfig(config, [config.d1_databases[0].database_id], now),
    ).toThrow());
  it("verifies remote UUID AND name before any remote action", async () => {
    const request = vi.fn(async () =>
      Response.json({
        success: true,
        result: {
          name: "academic-opportunities-demo-db",
          uuid: config.d1_databases[0].database_id,
        },
      }),
    );
    await expect(
      verifyIdentity(config, { token: "test-not-real", request }),
    ).rejects.toThrow("isolated");
    const good = vi.fn(async () =>
      Response.json({
        success: true,
        result: { name: DATABASE, uuid: config.d1_databases[0].database_id },
      }),
    );
    await expect(
      verifyIdentity(config, { token: "test-not-real", request: good }),
    ).resolves.toBeUndefined();
  });
  it("requires action-specific confirmation before metadata or mutation", async () => {
    const verify = vi.fn(),
      run = vi.fn();
    for (const confirmation of [undefined, "DEPLOY DEMO", "INIT SYNTHETIC POC"])
      await expect(
        runAction("deploy", config, { confirmation, verify, run }),
      ).rejects.toThrow("confirmation");
    expect(verify).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("refuses a changed on-disk config and failed identity", async () => {
    const run = vi.fn();
    await expect(
      runAction("deploy", config, {
        confirmation: "DEPLOY SYNTHETIC POC",
        verify: async () => {},
        load: () => ({
          ...config,
          vars: { ...config.vars, AGENT_ENABLED: "true" },
        }),
        run,
      }),
    ).rejects.toThrow("changed");
    expect(run).not.toHaveBeenCalled();
    await expect(
      runAction("init", config, {
        confirmation: "INIT SYNTHETIC POC",
        verify: async () => {
          throw new Error("identity");
        },
        run,
      }),
    ).rejects.toThrow("identity");
    expect(run).not.toHaveBeenCalled();
  });
  it("uses the fixed isolated config for guarded deployment and disable", async () => {
    const run = vi.fn(),
      save = vi.fn();
    await runAction("deploy", config, {
      confirmation: "DEPLOY SYNTHETIC POC",
      verify: async () => {},
      load: () => config,
      run,
    });
    expect(run.mock.calls[0][0][0]).toBe("deploy");
    const enabled = structuredClone(config);
    enabled.vars.AGENT_ENABLED = "true";
    await runAction("disable", enabled, {
      confirmation: "DISABLE SYNTHETIC POC",
      verify: async () => {},
      load: () => enabled,
      run,
      save,
    });
    expect(save.mock.calls[0][0].vars.AGENT_ENABLED).toBe("false");
    expect(actionArgs("migrate")).toContain("--remote");
    expect(() => actionArgs("production")).toThrow();
  });
  it("checks issuer, endpoints and S256 discovery without claiming a successful login", async () => {
    const issuer = config.vars.AGENT_AUTH_ISSUER;
    const document = {
      issuer,
      authorization_endpoint: issuer + "authorize",
      token_endpoint: issuer + "oauth/token",
      code_challenge_methods_supported: ["S256"],
      response_types_supported: ["code"],
      token_endpoint_auth_methods_supported: ["none"],
    };
    expect(
      (await checkOAuth(config, async () => Response.json(document))).pkce,
    ).toBe("S256");
    await expect(
      checkOAuth(config, async () =>
        Response.json({
          ...document,
          code_challenge_methods_supported: ["plain"],
        }),
      ),
    ).rejects.toThrow();
  });
});
describe("Auth0 post-login restriction", () => {
  function event() {
    return {
      secrets: {
        ALLOWED_CLIENT_ID: "provided",
        ALLOWED_SUBJECT: "auth0|approved",
        EXPECTED_RESOURCE: "https://poc.example/mcp",
      },
      client: { client_id: "provided" },
      user: { user_id: "auth0|approved", email_verified: true },
      resource_server: { identifier: "https://poc.example/mcp" },
      request: {
        query: {
          resource: "https://poc.example/mcp",
          response_type: "code",
          code_challenge_method: "S256",
          code_challenge: "a".repeat(43),
        },
      },
    };
  }
  it("allows only the intended user/client/resource and S256 code request", async () => {
    const deny = vi.fn();
    await restriction.onExecutePostLogin(event(), { access: { deny } });
    expect(deny).not.toHaveBeenCalled();
  });
  it.each([
    (e: any) => (e.secrets = {}),
    (e: any) => (e.user.user_id = "auth0|other"),
    (e: any) => (e.user.email_verified = false),
    (e: any) => (e.client.client_id = "rogue"),
    (e: any) => delete e.resource_server,
    (e: any) => (e.request.query.resource = "https://production.example/mcp"),
    (e: any) => (e.request.query.code_challenge_method = "plain"),
    (e: any) => delete e.request.query.code_challenge,
    (e: any) => (e.request.query.response_type = "token"),
  ])("denies missing/wrong authorization input %#", async (mutate) => {
    const e = event();
    mutate(e);
    const deny = vi.fn();
    await restriction.onExecutePostLogin(e, { access: { deny } });
    expect(deny).toHaveBeenCalledExactlyOnceWith(
      "Synthetic test authorization denied",
    );
  });
});
describe("synthetic bootstrap and MCP-only resource server", () => {
  let mf: Miniflare, db: D1Database, env: AgentEnv, principal: any;
  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("no endpoint")}}',
      d1Databases: ["DB"],
    });
    db = await mf.getD1Database("DB");
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
    env = {
      ...identity.env,
      APP_ENV: "poc",
      AGENT_TEST_EXPIRES_AT: new Date(now + 3600000).toISOString(),
      DB: db,
    };
    principal = {
      id: await digest(
        `${env.AGENT_AUTH_ISSUER}\n${env.AGENT_AUTH_SUBJECT}\n${env.AGENT_AUTH_CLIENT_ID}`,
      ),
      scopes: ["agent:read:synthetic", "agent:submit:synthetic"],
    };
  });

  // A fresh disposable local DB per test; never a remote binding.
  async function bootstrap() {
    await db.batch(
      statements(fixtureSql(new Date(now))).map((s) => db.prepare(s)),
    );
  }
  it("initializes only three explicit synthetic receipts, safely repeated, without MIME/R2 jobs", async () => {
    try {
      await bootstrap();
      await bootstrap();
      expect(
        (await db.prepare("SELECT COUNT(*) AS n FROM messages").first()).n,
      ).toBe(3);
      expect(
        (await db.prepare("SELECT COUNT(*) AS n FROM jobs").first()).n,
      ).toBe(0);
      const batch = await pendingBatch(env, principal, { limit: 3 }, now);
      expect(batch.messages).toHaveLength(3);
      expect(
        (
          await pendingBatch(
            { ...env, APP_ENV: "local" },
            { ...principal, id: "local-only-test" },
            { limit: 3 },
            now,
          )
        ).messages,
      ).toHaveLength(0);
      const body = {
        schemaVersion: 1,
        batchId: batch.batchId,
        submissionId: crypto.randomUUID(),
        results: expected,
      };
      const saved = await submitResults(env, principal, body, now);
      expect(saved.state).toBe("pending_validation");
      expect(await submitResults(env, principal, body, now)).toEqual(saved);
      await bootstrap();
      const verification = await verifyStored(
        config,
        async (sql) => (await db.prepare(sql).all()).results,
        contracts,
      );
      expect(verification.publicationCount).toBe(0);
      expect(verification.messageCount).toBe(3);
    } finally {
      await mf.dispose();
    }
  });
  it("refuses contamination and tombstones without changing anything", async () => {
    try {
      await db
        .prepare("INSERT INTO deletion_tombstones VALUES(?,?,?)")
        .bind(
          fixtureManifest[0].messageId,
          new Date(now).toISOString(),
          new Date(now).toISOString(),
        )
        .run();
      await expect(bootstrap()).rejects.toThrow();
      expect(
        (await db.prepare("SELECT COUNT(*) AS n FROM messages").first()).n,
      ).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
  it("refuses unexpected messages without initializing additional fixtures", async () => {
    try {
      await db
        .prepare(
          "INSERT INTO messages(id,mime_sha256,r2_key,received_at,delete_after,status) VALUES(?,?,?,?,?,'stored')",
        )
        .bind(
          "f".repeat(64),
          "f".repeat(64),
          "unexpected",
          "2026-10-19",
          "2026-10-20",
        )
        .run();
      await expect(bootstrap()).rejects.toThrow();
      expect(
        (await db.prepare("SELECT COUNT(*) AS n FROM messages").first()).n,
      ).toBe(1);
      expect(
        (await db.prepare("SELECT COUNT(*) AS n FROM agent_fixtures").first())
          .n,
      ).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
  it("suppresses deletion in PoC mode and cannot reinitialize it", async () => {
    try {
      await bootstrap();
      const batch = await pendingBatch(env, principal, { limit: 3 }, now);
      await db
        .prepare("UPDATE messages SET status='deleted' WHERE id=?")
        .bind(fixtureManifest[0].messageId)
        .run();
      expect(
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM agent_fixture_bootstraps")
            .first()
        ).n,
      ).toBe(2);
      await expect(
        submitResults(
          env,
          principal,
          {
            schemaVersion: 1,
            batchId: batch.batchId,
            submissionId: crypto.randomUUID(),
            results: expected,
          },
          now,
        ),
      ).rejects.toThrow("BATCH_UNAVAILABLE");
      await expect(bootstrap()).rejects.toThrow();
      expect(
        (await db.prepare("SELECT COUNT(*) AS n FROM agent_results").first()).n,
      ).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
  it("refuses corrupted MIME before generating SQL", async () => {
    try {
      expect(() =>
        fixtureSql(new Date(now), () => Buffer.from("changed")),
      ).toThrow("hash mismatch");
    } finally {
      await mf.dispose();
    }
  });
  it("closes REST and all unrelated paths before DB access in PoC mode", async () => {
    try {
      for (const path of [
        "/",
        "/api/opportunities",
        "/api/agent/pending-batch",
        "/raw",
      ])
        expect(
          (
            await handleAgentRequest(
              new Request(new URL(path, env.AGENT_RESOURCE)),
              env,
              now,
            )
          ).status,
        ).toBe(404);
      expect(
        (await handleAgentRequest(new Request(env.AGENT_RESOURCE), env, now))
          .status,
      ).toBe(401);
      expect(
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM agent_rate_limits")
            .first()
        ).n,
      ).toBe(0);
      expect(
        (
          await probe(config, async (input: any, init: any) =>
            handleAgentRequest(new Request(input, init), env, now),
          )
        ).extraRoutesClosed,
      ).toBe(true);
      const expired = {
        ...env,
        AGENT_TEST_EXPIRES_AT: new Date(now - 1).toISOString(),
      };
      expect(
        (
          await handleAgentRequest(
            new Request(env.AGENT_RESOURCE),
            expired,
            now,
          )
        ).status,
      ).toBe(503);
    } finally {
      await mf.dispose();
    }
  });
});
