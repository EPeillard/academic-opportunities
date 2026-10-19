import { z } from "zod";
import { format } from "prettier";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export function agentOpenApi(contracts) {
  const schema = (name) => z.toJSONSchema(contracts[name]);
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
  const json = (name) => ({ "application/json": { schema: ref(name) } });
  return {
    openapi: "3.1.0",
    info: {
      title: "Academic Opportunities synthetic extraction PoC",
      version: "0.1.0",
      description:
        "Private synthetic-only bridge. No publication, raw MIME, real messages or live URL is provided.",
    },
    servers: [
      {
        url: "https://agent-poc.example.invalid",
        description:
          "Replace only after separately authorized isolated HTTPS exposure.",
      },
    ],
    paths: {
      "/api/agent/pending-batch": {
        get: {
          operationId: "getPendingSyntheticBatch",
          summary: "Claim or resume a synthetic extraction batch",
          description:
            "Returns at most three curated untrusted synthetic messages. Allocates a private batch with a fifteen-minute expiry.",
          "x-openai-isConsequential": true,
          security: [{ OAuth: ["agent:read:synthetic"] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 3, default: 3 },
            },
            {
              name: "cursor",
              in: "query",
              required: false,
              schema: { type: "string", pattern: "^[a-f0-9]{64}$" },
            },
          ],
          responses: {
            200: {
              description: "Synthetic pending batch or empty result",
              content: json("BatchResponse"),
            },
            ...errors(),
          },
        },
      },
      "/api/agent/extraction-results": {
        post: {
          operationId: "submitSyntheticExtractionResults",
          summary: "Submit a complete synthetic batch for later validation",
          description:
            "Strict, idempotent private submission. Batch, principal, expiry and evidence are checked. No automatic publication.",
          "x-openai-isConsequential": true,
          security: [{ OAuth: ["agent:submit:synthetic"] }],
          requestBody: { required: true, content: json("Submission") },
          responses: {
            200: {
              description:
                "Immutable pending-validation receipt; identical retries return the same receipt",
              content: json("Receipt"),
            },
            ...errors(),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        OAuth: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: "https://auth.example.invalid/authorize",
              tokenUrl: "https://auth.example.invalid/token",
              scopes: {
                "agent:read:synthetic": "Retrieve synthetic fixtures only",
                "agent:submit:synthetic":
                  "Submit private synthetic candidates only",
              },
            },
          },
        },
      },
      schemas: {
        BatchQuery: schema("BatchQuerySchema"),
        BatchResponse: schema("BatchResponseSchema"),
        Submission: schema("SubmissionSchema"),
        Receipt: schema("ReceiptSchema"),
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"],
          additionalProperties: false,
        },
      },
    },
  };
}
function errors() {
  return Object.fromEntries(
    [400, 401, 403, 404, 409, 410, 413, 415, 429, 503].map((code) => [
      code,
      {
        description: {
          400: "Invalid request or evidence",
          401: "Authentication required",
          403: "Scope or origin denied",
          404: "Unknown or unauthorized batch",
          409: "Idempotency or allocation conflict",
          410: "Expired or suppressed batch",
          413: "Request exceeds byte limit",
          415: "JSON required",
          429: "Request limit reached",
          503: "Disabled, unconfigured or unavailable",
        }[code],
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    ]),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    logLevel: "error",
  });
  try {
    const contracts = await server.ssrLoadModule(
      "/apps/agent/src/contracts.ts",
    );
    writeFileSync(
      new URL("../docs/integrations/agent-openapi.json", import.meta.url),
      await format(JSON.stringify(agentOpenApi(contracts)), { parser: "json" }),
    );
    console.log(
      "Generated synthetic REST OpenAPI offline. No endpoint or ChatGPT connection created.",
    );
  } finally {
    await server.close();
  }
}
