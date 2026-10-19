import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function productionConfigs({ accountId, databaseId }) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? ""))
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      databaseId ?? "",
    ) ||
    /^00000000-0000-0000-0000-/.test(databaseId)
  ) {
    throw new Error(
      "CLOUDFLARE_D1_DATABASE_ID must be the provisioned D1 UUID, not a local placeholder.",
    );
  }
  return ["worker", "ingestion"].map((app) => {
    const config = parse(
      readFileSync(
        new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url),
        "utf8",
      ),
    );
    config.account_id = accountId;
    config.name =
      app === "worker"
        ? "academic-opportunities"
        : "academic-opportunities-ingestion";
    config.vars =
      app === "ingestion"
        ? {
            ...config.vars,
            APP_ENV: "production",
            INGESTION_ENABLED: "false",
            PROCESSING_ENABLED: "false",
          }
        : { APP_ENV: "production" };
    if (app === "ingestion") {
      delete config.queues.consumers;
      delete config.triggers;
    }
    config.d1_databases = config.d1_databases.map((db) => ({
      ...db,
      database_id: databaseId,
      remote: false,
    }));
    // These flags make even `wrangler dev` with a production config use local simulations.
    // Only an explicit deploy or D1 --remote command touches the actual account.
    return { app, config };
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const configs = productionConfigs({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
    });
    for (const { app, config } of configs) {
      writeFileSync(
        new URL(`../apps/${app}/wrangler.production.jsonc`, import.meta.url),
        JSON.stringify(config, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
    console.log(
      "Generated ignored production configs for public and ingestion Workers. No Cloudflare request was made.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
