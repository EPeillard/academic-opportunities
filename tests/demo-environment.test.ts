import { describe, it, expect, vi } from "vitest";
import {
  createDemoConfig,
  validateDemoConfig,
  verifyDemoIdentity,
  runDemoAction,
  demoActionArgs,
  DEMO_DATABASE,
} from "../scripts/demo-environment.mjs";
const accountId = "a".repeat(32),
  databaseId = "12345678-1234-4234-8234-123456789abc";
const configuration = () => createDemoConfig({ accountId, databaseId });
describe("demo isolation and deployment guards", () => {
  it("prepares workers.dev with only isolated D1 and existing Static Assets", () => {
    const config = configuration();
    expect(config.name).toBe("academic-opportunities-demo");
    expect(config.workers_dev).toBe(true);
    expect(config.routes).toEqual([]);
    expect(config.preview_urls).toBe(false);
    expect(config.vars.APP_ENV).toBe("demo");
    expect(config.d1_databases[0].database_name).toBe(DEMO_DATABASE);
    expect(config.d1_databases[0].remote).toBe(false);
    expect(config.r2_buckets).toBeUndefined();
    expect(config.queues).toBeUndefined();
  });
  it.each([
    "00000000-0000-0000-0000-000000000001",
    "academic-opportunities-db",
    "",
  ])("rejects invalid/local demo identifier %s", (id) => {
    expect(() => createDemoConfig({ accountId, databaseId: id })).toThrow();
  });
  it("rejects a known production UUID even if provided under the demo variable", () => {
    expect(() =>
      createDemoConfig({ accountId, databaseId, forbiddenIds: [databaseId] }),
    ).toThrow();
  });
  it.each(["r2_buckets", "queues", "services", "triggers", "env"])(
    "blocks an unexpected %s capability",
    (key) => {
      expect(() =>
        validateDemoConfig({ ...configuration(), [key]: {} }),
      ).toThrow();
    },
  );
  it("rejects active domain routing, production database names and source overrides", () => {
    const config = configuration();
    expect(() =>
      validateDemoConfig({
        ...config,
        routes: [{ pattern: "jobs.etiennepeillard.com", custom_domain: true }],
      }),
    ).toThrow();
    expect(() =>
      validateDemoConfig({ ...config, main: "../ingestion/src/index.ts" }),
    ).toThrow();
    config.d1_databases[0].database_name = "academic-opportunities-db";
    expect(() => validateDemoConfig(config)).toThrow();
  });
  it("verifies metadata identity without making a SQL request", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: { name: DEMO_DATABASE, uuid: databaseId },
      }),
    );
    await verifyDemoIdentity(configuration(), { token: "test-token", request });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`,
    );
    expect(request.mock.calls[0][1].method).toBeUndefined();
  });
  it.each(["migrate", "seed", "deploy"])(
    "does not run %s after identity verification fails",
    async (action) => {
      const run = vi.fn();
      await expect(
        runDemoAction(action, configuration(), {
          verify: async () => {
            throw new Error("not demo");
          },
          run,
          load: configuration,
        }),
      ).rejects.toThrow("not demo");
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("rejects a production metadata response or missing token", async () => {
    await expect(
      verifyDemoIdentity(configuration(), { token: "" }),
    ).rejects.toThrow();
    await expect(
      verifyDemoIdentity(configuration(), {
        token: "test-token",
        request: async () =>
          Response.json({
            success: true,
            result: { name: "academic-opportunities-db", uuid: databaseId },
          }),
      }),
    ).rejects.toThrow("does not match");
  });
  it("runs only the fixed seed file after a successful identity check", async () => {
    const run = vi.fn();
    const verify = vi.fn().mockResolvedValue(undefined);
    await runDemoAction("seed", configuration(), {
      verify,
      run,
      load: configuration,
    });
    expect(run).toHaveBeenCalledWith(demoActionArgs("seed"));
    expect(run.mock.calls[0][0]).toContain("--remote");
    expect(run.mock.calls[0][0].at(-1)).toMatch(
      /worker\/seeds\/synthetic.sql$/,
    );
  });
  it("aborts if the config changes after verification", async () => {
    const run = vi.fn();
    await expect(
      runDemoAction("deploy", configuration(), {
        verify: async () => {},
        run,
        load: () => ({ ...configuration(), account_id: "b".repeat(32) }),
      }),
    ).rejects.toThrow("changed");
    expect(run).not.toHaveBeenCalled();
  });
});
