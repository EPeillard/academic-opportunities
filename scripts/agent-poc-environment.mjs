import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse } from "jsonc-parser";
import { fixtureSql } from "./agent-poc-fixtures.mjs";
export const WORKER = "academic-opportunities-agent-poc";
export const DATABASE = "academic-opportunities-agent-poc-db";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const configPath = join(root, "apps/agent/wrangler.poc.jsonc");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const fail = () => {
  throw new Error("Unsafe or incomplete synthetic PoC configuration");
};
function exactKeys(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    fail();
}
export function validateConfig(c, forbiddenIds = [], now = Date.now()) {
  exactKeys(c, [
    "$schema",
    "name",
    "main",
    "compatibility_date",
    "account_id",
    "workers_dev",
    "preview_urls",
    "routes",
    "triggers",
    "observability",
    "vars",
    "d1_databases",
  ]);
  if (
    c.name !== WORKER ||
    c.main !== "src/index.ts" ||
    c.$schema !== "../../node_modules/wrangler/config-schema.json" ||
    c.compatibility_date !== "2026-06-11" ||
    !/^[a-f0-9]{32}$/.test(c.account_id) ||
    c.workers_dev !== true ||
    c.preview_urls !== false ||
    JSON.stringify(c.routes) !== "[]" ||
    JSON.stringify(c.triggers) !== '{"crons":[]}' ||
    JSON.stringify(c.observability) !== '{"enabled":false}'
  )
    fail();
  const v = c.vars;
  exactKeys(v, [
    "APP_ENV",
    "AGENT_ENABLED",
    "AGENT_RESOURCE",
    "AGENT_AUTH_ISSUER",
    "AGENT_AUTH_SUBJECT",
    "AGENT_AUTH_CLIENT_ID",
    "AGENT_AUTH_JWKS_JSON",
    "AGENT_TEST_EXPIRES_AT",
  ]);
  if (v.APP_ENV !== "poc" || !["false", "true"].includes(v.AGENT_ENABLED))
    fail();
  const resource = new URL(v.AGENT_RESOURCE),
    issuer = new URL(v.AGENT_AUTH_ISSUER);
  if (
    resource.href !== v.AGENT_RESOURCE ||
    resource.protocol !== "https:" ||
    !new RegExp(`^${WORKER}\\.[a-z0-9-]+\\.workers\\.dev$`).test(
      resource.hostname,
    ) ||
    resource.port ||
    resource.pathname !== "/mcp" ||
    resource.search ||
    resource.hash ||
    resource.username ||
    resource.password
  )
    fail();
  if (
    issuer.protocol !== "https:" ||
    !/^[a-z0-9-]+\.(?:[a-z0-9-]+\.)?auth0\.com$/.test(issuer.hostname) ||
    issuer.port ||
    issuer.pathname !== "/" ||
    issuer.search ||
    issuer.hash ||
    issuer.username ||
    issuer.password ||
    issuer.href !== v.AGENT_AUTH_ISSUER
  )
    fail();
  if (
    typeof v.AGENT_AUTH_SUBJECT !== "string" ||
    !v.AGENT_AUTH_SUBJECT ||
    v.AGENT_AUTH_SUBJECT.length > 200 ||
    typeof v.AGENT_AUTH_CLIENT_ID !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(v.AGENT_AUTH_CLIENT_ID)
  )
    fail();
  const expires = Date.parse(v.AGENT_TEST_EXPIRES_AT);
  if (
    !Number.isFinite(expires) ||
    expires <= now ||
    expires - now > 7 * 86400000
  )
    fail();
  if (
    typeof v.AGENT_AUTH_JWKS_JSON !== "string" ||
    v.AGENT_AUTH_JWKS_JSON.length > 16000
  )
    fail();
  const jwks = JSON.parse(v.AGENT_AUTH_JWKS_JSON);
  exactKeys(jwks, ["keys"]);
  if (!Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 2)
    fail();
  const kids = new Set();
  for (const k of jwks.keys) {
    if (
      !k ||
      Object.keys(k).some(
        (n) => !["kty", "alg", "kid", "n", "e", "use"].includes(n),
      ) ||
      k.kty !== "RSA" ||
      k.alg !== "RS256" ||
      typeof k.kid !== "string" ||
      !k.kid ||
      k.kid.length > 100 ||
      kids.has(k.kid) ||
      !/^[A-Za-z0-9_-]{342,1400}$/.test(k.n) ||
      !/^[A-Za-z0-9_-]{1,10}$/.test(k.e) ||
      (k.use && k.use !== "sig")
    )
      fail();
    kids.add(k.kid);
  }
  if (!Array.isArray(c.d1_databases) || c.d1_databases.length !== 1) fail();
  const d = c.d1_databases[0];
  exactKeys(d, [
    "binding",
    "database_name",
    "database_id",
    "migrations_dir",
    "remote",
  ]);
  if (
    d.binding !== "DB" ||
    d.database_name !== DATABASE ||
    d.remote !== false ||
    d.migrations_dir !== "../worker/migrations" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      d.database_id,
    ) ||
    forbiddenIds.some((id) => id.toLowerCase() === d.database_id.toLowerCase())
  )
    fail();
  return c;
}
export function createConfig(env = process.env, now = Date.now()) {
  const c = {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: WORKER,
    main: "src/index.ts",
    compatibility_date: "2026-06-11",
    account_id: env.CLOUDFLARE_ACCOUNT_ID,
    workers_dev: true,
    preview_urls: false,
    routes: [],
    triggers: { crons: [] },
    observability: { enabled: false },
    vars: {
      APP_ENV: "poc",
      AGENT_ENABLED: "false",
      AGENT_RESOURCE: env.AGENT_RESOURCE,
      AGENT_AUTH_ISSUER: env.AGENT_AUTH_ISSUER,
      AGENT_AUTH_SUBJECT: env.AGENT_AUTH_SUBJECT,
      AGENT_AUTH_CLIENT_ID: env.AGENT_AUTH_CLIENT_ID,
      AGENT_AUTH_JWKS_JSON: env.AGENT_AUTH_JWKS_JSON,
      AGENT_TEST_EXPIRES_AT: env.AGENT_TEST_EXPIRES_AT,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: DATABASE,
        database_id: env.CLOUDFLARE_AGENT_POC_D1_DATABASE_ID,
        migrations_dir: "../worker/migrations",
        remote: false,
      },
    ],
  };
  return validateConfig(c, knownOtherIds(env), now);
}
export function knownOtherIds(env = process.env) {
  const ids = [
    env.CLOUDFLARE_D1_DATABASE_ID,
    env.CLOUDFLARE_DEMO_D1_DATABASE_ID,
  ];
  for (const app of ["worker", "ingestion"])
    for (const kind of ["production", "demo"]) {
      const path = join(root, `apps/${app}/wrangler.${kind}.jsonc`);
      if (existsSync(path))
        ids.push(
          ...(parse(readFileSync(path, "utf8")).d1_databases ?? []).map(
            (d) => d.database_id,
          ),
        );
    }
  return ids.filter(Boolean);
}
async function cloudflare(c, suffix, token, { request = fetch, body } = {}) {
  if (!token) throw new Error("Missing Cloudflare token in local environment");
  const r = await request(
    `https://api.cloudflare.com/client/v4/accounts/${c.account_id}/d1/database/${c.d1_databases[0].database_id}${suffix}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) throw new Error("Cloudflare PoC request failed");
  const data = await r.json();
  if (data.success !== true) throw new Error("Cloudflare PoC request failed");
  return data.result;
}
export async function verifyIdentity(
  c,
  { token = process.env.CLOUDFLARE_API_TOKEN, request = fetch } = {},
) {
  validateConfig(c, knownOtherIds());
  const data = await cloudflare(c, "", token, { request });
  if (
    data?.name !== DATABASE ||
    data?.uuid?.toLowerCase() !== c.d1_databases[0].database_id
  )
    throw new Error("Remote D1 is not the isolated synthetic PoC database");
}
export async function queryPoc(c, sql, options = {}) {
  const result = await cloudflare(
    c,
    "/query",
    options.token ?? process.env.CLOUDFLARE_API_TOKEN,
    { request: options.request ?? fetch, body: { sql } },
  );
  if (!Array.isArray(result) || result.some((r) => !r.success))
    throw new Error("Private PoC query failed");
  return result.flatMap((r) => r.results ?? []);
}
export function actionArgs(action, file) {
  const cfg = ["--config", configPath];
  if (action === "migrate")
    return ["d1", "migrations", "apply", "DB", ...cfg, "--remote"];
  if (action === "init")
    return ["d1", "execute", "DB", ...cfg, "--remote", "--file", file];
  if (["deploy", "disable"].includes(action)) return ["deploy", ...cfg];
  throw new Error("Unknown synthetic PoC action");
}
const runWrangler = (args, c) =>
  execFileSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: c.account_id,
      WRANGLER_SEND_METRICS: "false",
    },
  });
export async function runAction(
  action,
  c,
  {
    confirmation = process.env.AGENT_POC_CONFIRM,
    verify = verifyIdentity,
    run = runWrangler,
    load = () => parse(readFileSync(configPath, "utf8")),
    save = (value) =>
      writeFileSync(configPath, JSON.stringify(value, null, 2) + "\n", {
        mode: 0o600,
      }),
  } = {},
) {
  if (
    !["migrate", "init", "deploy", "disable"].includes(action) ||
    confirmation !== `${action.toUpperCase()} SYNTHETIC POC`
  )
    throw new Error("Explicit action-specific PoC confirmation required");
  validateConfig(c, knownOtherIds());
  await verify(c);
  const disk = validateConfig(load(), knownOtherIds());
  if (JSON.stringify(disk) !== JSON.stringify(c))
    throw new Error("PoC config changed during verification");
  let dir;
  try {
    if (action === "disable") {
      c = structuredClone(c);
      c.vars.AGENT_ENABLED = "false";
      save(c);
    }
    let file;
    if (action === "init") {
      dir = mkdtempSync(join(tmpdir(), "agent-poc-"));
      file = join(dir, "fixtures.sql");
      writeFileSync(file, fixtureSql(), { mode: 0o600 });
    }
    return await run(actionArgs(action, file), c);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
export async function checkOAuth(c, request = fetch) {
  validateConfig(c, knownOtherIds());
  const issuer = c.vars.AGENT_AUTH_ISSUER;
  const r = await request(`${issuer}.well-known/openid-configuration`, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("OAuth discovery unavailable");
  const text = await r.text();
  if (text.length > 32000) throw new Error("OAuth discovery too large");
  const d = JSON.parse(text);
  if (
    d.issuer !== issuer ||
    d.authorization_endpoint !== `${issuer}authorize` ||
    d.token_endpoint !== `${issuer}oauth/token` ||
    !d.code_challenge_methods_supported?.includes("S256") ||
    !d.response_types_supported?.includes("code") ||
    !d.token_endpoint_auth_methods_supported?.includes("none")
  )
    throw new Error(
      "OAuth discovery does not meet the chosen public-client PKCE profile",
    );
  return {
    issuer: d.issuer,
    pkce: "S256",
    mode: "predefined-public-client",
    note: "Login, access token claims, resource mapping and ChatGPT availability still require interactive testing",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const action = process.argv[2];
    if (action === "configure") {
      const env = {
        ...process.env,
        AGENT_AUTH_JWKS_JSON: readFileSync(
          process.env.AGENT_POC_JWKS_FILE,
          "utf8",
        ),
      };
      // Auth0 JWKS includes x5c/x5t: retain only public fields consumed by our validator.
      const source = JSON.parse(env.AGENT_AUTH_JWKS_JSON);
      if (
        !Array.isArray(source.keys) ||
        source.keys.some(
          (k) =>
            !k ||
            ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((n) => n in k),
        )
      )
        throw new Error("Public JWKS only");
      env.AGENT_AUTH_JWKS_JSON = JSON.stringify({
        keys: source.keys.map((k) =>
          Object.fromEntries(
            ["kty", "alg", "kid", "n", "e", "use"]
              .filter((n) => k[n] !== undefined)
              .map((n) => [n, k[n]]),
          ),
        ),
      });
      writeFileSync(
        configPath,
        JSON.stringify(createConfig(env), null, 2) + "\n",
        { mode: 0o600 },
      );
      console.log(
        "Generated disabled synthetic PoC config offline. No resources created.",
      );
    } else {
      const c = validateConfig(
        parse(readFileSync(configPath, "utf8")),
        knownOtherIds(),
      );
      if (action === "dry-run")
        runWrangler(
          [
            "deploy",
            "--config",
            configPath,
            "--dry-run",
            "--outdir",
            "dist-poc",
          ],
          c,
        );
      else if (action === "verify-target") {
        await verifyIdentity(c);
        console.log("Isolated PoC D1 identity verified; no data changed.");
      } else if (action === "check-oauth") {
        console.log(JSON.stringify(await checkOAuth(c)));
      } else await runAction(action, c);
    }
  } catch {
    console.error(
      "Synthetic PoC operation refused or failed. Check local configuration, explicit confirmation and documented prerequisites; no credentials are printed.",
    );
    process.exitCode = 1;
  }
}
