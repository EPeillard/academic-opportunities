import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse } from "jsonc-parser";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

export const DEMO_WORKER = "academic-opportunities-demo";
export const DEMO_DATABASE = "academic-opportunities-demo-db";
export const demoConfigPath = fileURLToPath(
  new URL("../apps/worker/wrangler.demo.generated.jsonc", import.meta.url),
);
const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function validateDemoConfig(config, forbiddenIds = []) {
  const allowed = [
    "$schema",
    "name",
    "account_id",
    "main",
    "compatibility_date",
    "workers_dev",
    "preview_urls",
    "assets",
    "d1_databases",
    "vars",
    "routes",
  ];
  if (Object.keys(config).some((key) => !allowed.includes(key)))
    throw new Error("Unexpected demo capability/configuration.");
  if (
    config.name !== DEMO_WORKER ||
    !/^[a-f0-9]{32}$/i.test(config.account_id ?? "") ||
    config.workers_dev !== true ||
    config.preview_urls !== false ||
    config.vars?.APP_ENV !== "demo" ||
    Object.keys(config.vars).length !== 1 ||
    !Array.isArray(config.routes) ||
    config.routes.length !== 0
  )
    throw new Error("Demo identity, exposure or routing is invalid.");
  const databases = config.d1_databases;
  if (!Array.isArray(databases) || databases.length !== 1)
    throw new Error("Demo requires exactly one isolated database.");
  const db = databases[0];
  if (
    db.binding !== "DB" ||
    db.database_name !== DEMO_DATABASE ||
    !uuid.test(db.database_id ?? "") ||
    /^00000000-0000-0000-0000-/i.test(db.database_id) ||
    forbiddenIds.some(
      (id) => id?.toLowerCase() === db.database_id.toLowerCase(),
    ) ||
    db.remote !== false ||
    db.migrations_dir !== "migrations" ||
    Object.keys(db).some(
      (k) =>
        ![
          "binding",
          "database_name",
          "database_id",
          "remote",
          "migrations_dir",
        ].includes(k),
    )
  )
    throw new Error("Unsafe demo D1 target.");
  // Fix entrypoint and asset paths: a modified file must not deploy another Worker or ingestion bundle.
  if (
    config.main !== "src/index.ts" ||
    config.assets?.directory !== "../web/dist" ||
    config.assets?.binding !== "ASSETS" ||
    config.assets?.not_found_handling !== "single-page-application" ||
    JSON.stringify(config.assets?.run_worker_first) !==
      JSON.stringify(["/api/*", "/admin", "/admin/*"]) ||
    Object.keys(config.assets).length !== 4
  )
    throw new Error("Unexpected demo application/asset configuration.");
  return config;
}
export function createDemoConfig({ accountId, databaseId, forbiddenIds = [] }) {
  const config = parse(
    readFileSync(
      new URL("../apps/worker/wrangler.jsonc", import.meta.url),
      "utf8",
    ),
  );
  config.name = DEMO_WORKER;
  config.account_id = accountId;
  config.workers_dev = true;
  config.preview_urls = false;
  config.routes = [];
  config.vars = { APP_ENV: "demo" };
  config.d1_databases = [
    {
      binding: "DB",
      database_name: DEMO_DATABASE,
      database_id: databaseId,
      migrations_dir: "migrations",
      remote: false,
    },
  ];
  return validateDemoConfig(config, forbiddenIds);
}
function knownProductionIds() {
  const ids = [process.env.CLOUDFLARE_D1_DATABASE_ID];
  for (const app of ["worker", "ingestion"]) {
    const path = new URL(
      `../apps/${app}/wrangler.production.jsonc`,
      import.meta.url,
    );
    if (existsSync(path))
      ids.push(
        ...parse(readFileSync(path, "utf8")).d1_databases.map(
          (db) => db.database_id,
        ),
      );
  }
  return ids.filter(Boolean);
}
export async function verifyDemoIdentity(
  config,
  { token, request = fetch } = {},
) {
  validateDemoConfig(config, knownProductionIds());
  if (!token)
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN with D1 Read/Edit for the approved remote action.",
    );
  const id = config.d1_databases[0].database_id;
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${id}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error("Could not verify demo D1 identity. No mutation was run.");
  const data = await response.json();
  if (
    data.success !== true ||
    data.result?.name !== DEMO_DATABASE ||
    data.result?.uuid?.toLowerCase() !== id.toLowerCase()
  )
    throw new Error(
      "Remote D1 identity does not match the isolated demo database. No mutation was run.",
    );
}
export function demoActionArgs(action) {
  const cfg = ["--config", demoConfigPath];
  switch (action) {
    case "migrate":
      return ["d1", "migrations", "apply", "DB", ...cfg, "--remote"];
    case "seed":
      return [
        "d1",
        "execute",
        "DB",
        ...cfg,
        "--remote",
        "--file",
        fileURLToPath(
          new URL("../apps/worker/seeds/synthetic.sql", import.meta.url),
        ),
      ];
    case "deploy":
      return ["deploy", ...cfg];
    default:
      throw new Error("Unknown remote demo action.");
  }
}
export async function runDemoAction(
  action,
  config,
  {
    verify = verifyDemoIdentity,
    run = (args) =>
      execFileSync(process.execPath, [wrangler, ...args], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: config.account_id },
      }),
    token = process.env.CLOUDFLARE_API_TOKEN,
    load = () => parse(readFileSync(demoConfigPath, "utf8")),
  } = {},
) {
  const args = demoActionArgs(action);
  validateDemoConfig(config, knownProductionIds());
  await verify(config, { token });
  // Validate the exact on-disk config immediately before Wrangler loads it.
  const disk = validateDemoConfig(load(), knownProductionIds());
  if (JSON.stringify(disk) !== JSON.stringify(config))
    throw new Error("Demo config changed during identity verification.");
  return run(args);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const action = process.argv[2];
    if (action === "configure") {
      const config = createDemoConfig({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        databaseId: process.env.CLOUDFLARE_DEMO_D1_DATABASE_ID,
        forbiddenIds: knownProductionIds(),
      });
      writeFileSync(demoConfigPath, JSON.stringify(config, null, 2) + "\n", {
        mode: 0o600,
      });
      console.log(
        "Generated isolated demo config offline. Nothing was provisioned, seeded or deployed.",
      );
    } else if (action === "dry-run") {
      validateDemoConfig(
        parse(readFileSync(demoConfigPath, "utf8")),
        knownProductionIds(),
      );
      execFileSync(
        process.execPath,
        [
          wrangler,
          "deploy",
          "--config",
          demoConfigPath,
          "--dry-run",
          "--outdir",
          "dist-demo",
        ],
        {
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        },
      );
    } else if (action === "verify-target") {
      await verifyDemoIdentity(parse(readFileSync(demoConfigPath, "utf8")), {
        token: process.env.CLOUDFLARE_API_TOKEN,
      });
      console.log(
        "Remote metadata confirms the isolated demo D1 identity. No database mutation was performed.",
      );
    } else {
      await runDemoAction(action, parse(readFileSync(demoConfigPath, "utf8")));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
