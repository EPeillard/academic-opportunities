import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
import { productionConfigs } from "./configure-production.mjs";

// Offline preparation only. Never invoke this from the demo workflow.
export function activationConfig({
  accountId,
  databaseId,
  demoDatabaseId,
  prepareActivation,
}) {
  if (prepareActivation !== true)
    throw new Error(
      "Explicit --prepare-activation is required; this only prepares a file, not deployment approval.",
    );
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      demoDatabaseId ?? "",
    )
  )
    throw new Error(
      "Provide the demo UUID too, to check isolation before preparing activation.",
    );
  if (demoDatabaseId.toLowerCase() === databaseId?.toLowerCase())
    throw new Error("Production ingestion must not target the demo database.");
  const config = productionConfigs({ accountId, databaseId }).find(
    (c) => c.app === "ingestion",
  ).config;
  config.vars.INGESTION_ENABLED = "true";
  config.vars.PROCESSING_ENABLED = "true";
  config.queues.consumers = [
    {
      queue: "academic-opportunities-ingestion",
      max_batch_size: 5,
      max_batch_timeout: 2,
      max_retries: 3,
      retry_delay: 60,
      max_concurrency: 1,
    },
  ];
  config.triggers = { crons: ["* * * * *"] };
  return config;
}
export async function verifyIngestionTarget(
  config,
  { token, request = fetch } = {},
) {
  if (!token)
    throw new Error(
      "Cloudflare token must be supplied through a secure environment, never chat.",
    );
  const db = config.d1_databases?.[0];
  if (
    config.name !== "academic-opportunities-ingestion" ||
    db?.database_name !== "academic-opportunities-db" ||
    !/^[a-f0-9]{32}$/i.test(config.account_id ?? "") ||
    !/^[a-f0-9-]{36}$/i.test(db.database_id ?? "")
  )
    throw new Error("Invalid production ingestion target.");
  const result = await request(
    `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${db.database_id}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!result.ok)
    throw new Error(`D1 metadata verification failed (HTTP ${result.status}).`);
  const data = await result.json();
  if (
    data?.success !== true ||
    data.result?.name !== "academic-opportunities-db" ||
    data.result?.uuid?.toLowerCase() !== db.database_id.toLowerCase()
  )
    throw new Error("Production ingestion D1 identity mismatch. Stop rollout.");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv[2] === "verify-target") {
      const config = parse(
        readFileSync(
          new URL(
            "../apps/ingestion/wrangler.activation.jsonc",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await verifyIngestionTarget(config, {
        token: process.env.CLOUDFLARE_API_TOKEN,
      });
      console.log(
        "Production D1 metadata verified read-only. No migration or deployment performed.",
      );
    } else {
      const config = activationConfig({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
        demoDatabaseId: process.env.CLOUDFLARE_DEMO_D1_DATABASE_ID,
        prepareActivation: process.argv[2] === "--prepare-activation",
      });
      writeFileSync(
        new URL("../apps/ingestion/wrangler.activation.jsonc", import.meta.url),
        JSON.stringify(config, null, 2) + "\n",
        { mode: 0o600 },
      );
      console.log(
        "Prepared ignored activation config offline. No deployment, Queue attachment, cron or Email Routing change performed.",
      );
    }
  } catch {
    console.error(
      "Ingestion preparation/target check failed; check configuration securely. No deployment performed.",
    );
    process.exitCode = 1;
  }
}
