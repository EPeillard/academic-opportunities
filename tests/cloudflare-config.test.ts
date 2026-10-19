import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { Miniflare } from "miniflare";
import { productionConfigs } from "../scripts/configure-production.mjs";
import {
  activationConfig,
  verifyIngestionTarget,
} from "../scripts/prepare-ingestion.mjs";
import ingestion from "../apps/ingestion/src";
const local = (app: string) =>
  parse(
    readFileSync(
      new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url),
      "utf8",
    ),
  );
const ids = {
  accountId: "a".repeat(32),
  databaseId: "12345678-1234-4234-8234-123456789abc",
};
describe("Cloudflare resource isolation", () => {
  it("keeps production identifiers out of local configs and forbids remote development bindings", () => {
    for (const app of ["worker", "ingestion"]) {
      const config = local(app);
      expect(config.vars.APP_ENV).toBe("local");
      expect(config.d1_databases[0].database_id).toBe(
        "00000000-0000-0000-0000-000000000001",
      );
      expect(config.d1_databases[0].remote).toBe(false);
      expect(config.account_id).toBeUndefined();
      expect(config.workers_dev).toBe(false);
      expect(config.preview_urls).toBe(false);
      expect(config.routes).toBeUndefined();
    }
  });
  it("never grants the public Worker a raw-email or Queue capability", () => {
    for (const config of [
      local("worker"),
      productionConfigs(ids).find((c) => c.app === "worker")!.config,
    ]) {
      expect(config.r2_buckets).toBeUndefined();
      expect(config.queues).toBeUndefined();
      expect(config.d1_databases[0].database_name).toBe(
        "academic-opportunities-db",
      );
    }
  });
  it("generates exact provisioned names and one shared migration source without enabling consumers", () => {
    const configs = productionConfigs(ids);
    for (const { config } of configs) {
      expect(config.account_id).toBe(ids.accountId);
      expect(config.d1_databases[0].database_id).toBe(ids.databaseId);
      expect(config.vars.APP_ENV).toBe("production");
    }
    const config = configs.find((c) => c.app === "ingestion")!.config;
    expect(config.r2_buckets).toEqual([
      {
        binding: "RAW_EMAILS",
        bucket_name: "academic-opportunities-emails",
        remote: false,
      },
    ]);
    expect(config.queues.producers).toEqual([
      {
        binding: "INGESTION_QUEUE",
        queue: "academic-opportunities-ingestion",
        remote: false,
      },
    ]);
    expect(config.queues.consumers).toBeUndefined();
    expect(config.d1_databases[0].migrations_dir).toBe("../worker/migrations");
  });
  it("requires explicit offline activation preparation and never enables production triggers by default", async () => {
    const safe = productionConfigs(ids).find(
      (c) => c.app === "ingestion",
    )!.config;
    expect(safe.vars.INGESTION_ENABLED).toBe("false");
    expect(safe.vars.PROCESSING_ENABLED).toBe("false");
    expect(safe.triggers).toBeUndefined();
    expect(() =>
      activationConfig({ ...ids, prepareActivation: false }),
    ).toThrow();
    expect(() =>
      activationConfig({
        ...ids,
        prepareActivation: true,
        demoDatabaseId: ids.databaseId,
      }),
    ).toThrow();
    const active = activationConfig({
      ...ids,
      demoDatabaseId: "87654321-1234-4234-8234-123456789abc",
      prepareActivation: true,
    });
    expect(active.queues.consumers[0].queue).toBe(
      "academic-opportunities-ingestion",
    );
    expect(active.triggers.crons).toEqual(["* * * * *"]);
    expect(active.workers_dev).toBe(false);
    expect(active.routes).toBeUndefined();
    await expect(
      verifyIngestionTarget(active, {
        token: "test",
        request: async () =>
          Response.json({
            success: true,
            result: {
              name: "academic-opportunities-demo-db",
              uuid: ids.databaseId,
            },
          }),
      }),
    ).rejects.toThrow("mismatch");
    await expect(
      verifyIngestionTarget(active, {
        token: "test",
        request: async () =>
          Response.json({
            success: true,
            result: { name: "academic-opportunities-db", uuid: ids.databaseId },
          }),
      }),
    ).resolves.toBeUndefined();
  });
  it.each([
    { accountId: "", databaseId: ids.databaseId },
    { ...ids, databaseId: "academic-opportunities-db" },
    { ...ids, databaseId: "00000000-0000-0000-0000-000000000001" },
  ])("fails closed for missing or placeholder production IDs", (values) => {
    expect(() => productionConfigs(values)).toThrow();
  });
  it("resolves private bindings using local simulators and the scaffold never serves stored MIME", async () => {
    const config = local("ingestion");
    const mf = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("unused")}}',
      compatibilityDate: config.compatibility_date,
      d1Databases: { DB: config.d1_databases[0].database_id },
      r2Buckets: { RAW_EMAILS: config.r2_buckets[0].bucket_name },
      queueProducers: { INGESTION_QUEUE: config.queues.producers[0].queue },
    });
    try {
      const db = await mf.getD1Database("DB");
      expect((await db.prepare("SELECT 1 as ok").first())?.ok).toBe(1);
      const bucket = await mf.getR2Bucket("RAW_EMAILS");
      await bucket.put("private-message.eml", "PRIVATE SYNTHETIC MIME");
      expect(await (await bucket.get("private-message.eml"))?.text()).toBe(
        "PRIVATE SYNTHETIC MIME",
      );
      const queue = await mf.getQueueProducer("INGESTION_QUEUE");
      expect(typeof queue.send).toBe("function");
      const response = await ingestion.fetch();
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("PRIVATE SYNTHETIC MIME");
    } finally {
      await mf.dispose();
    }
  });
});
