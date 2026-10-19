import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { agentOpenApi } from "../scripts/generate-agent-openapi.mjs";
import * as contracts from "../apps/agent/src/contracts";
import { productionConfigs } from "../scripts/configure-production.mjs";
import { createDemoConfig } from "../scripts/demo-environment.mjs";
import { parse } from "jsonc-parser";
describe("integration definitions and configuration boundaries", () => {
  it("keeps OpenAPI in sync with strict Zod and explicit OAuth scopes/confirmation", () => {
    const document = JSON.parse(
      readFileSync(
        new URL("../docs/integrations/agent-openapi.json", import.meta.url),
        "utf8",
      ),
    );
    expect(document).toEqual(agentOpenApi(contracts));
    expect(document.servers[0].url).toBe("https://agent-poc.example.invalid");
    for (const path of Object.values(document.paths) as any[])
      for (const operation of Object.values(path) as any[]) {
        expect(operation.security[0].OAuth).toHaveLength(1);
        expect(operation["x-openai-isConsequential"]).toBe(true);
      }
    expect(document.components.schemas.Submission.additionalProperties).toBe(
      false,
    );
  });
  it("does not include the agent in any production/demo configuration generator", () => {
    const accountId = "a".repeat(32),
      databaseId = "12345678-1234-4234-8234-123456789abc";
    expect(
      productionConfigs({ accountId, databaseId }).map((c) => c.app),
    ).toEqual(["worker", "ingestion"]);
    const demo = createDemoConfig({ accountId, databaseId });
    expect(demo.r2_buckets).toBeUndefined();
    expect(demo.services).toBeUndefined();
    const cfg = parse(
      readFileSync(
        new URL("../apps/agent/wrangler.jsonc", import.meta.url),
        "utf8",
      ),
    );
    expect(cfg.vars).toEqual({ APP_ENV: "local", AGENT_ENABLED: "false" });
    expect(cfg.routes).toBeUndefined();
    expect(cfg.services).toBeUndefined();
  });
});
