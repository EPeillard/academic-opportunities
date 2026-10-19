import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery as statements } from "wrangler";
import { readFileSync } from "node:fs";
import { handleRequest } from "../apps/worker/src";
import type { Env } from "../apps/worker/src";
import { ListSchema, OpportunitySchema } from "../packages/shared/src";

let mf: Miniflare, env: Env;
const migration = readFileSync(
  new URL("../apps/worker/migrations/0001_foundation.sql", import.meta.url),
  "utf8",
);
const seed = readFileSync(
  new URL("../apps/worker/seeds/synthetic.sql", import.meta.url),
  "utf8",
);
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: "2026-06-11",
    d1Databases: { DB: "test-db" },
  });
  const db = await mf.getD1Database("DB");
  for (const stmt of statements(migration)) await db.prepare(stmt).run();
  for (let pass = 0; pass < 2; pass++)
    for (const stmt of statements(seed)) await db.prepare(stmt).run();
  env = {
    DB: db,
    ASSETS: {
      fetch: async () =>
        new Response("<html>App</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    },
  } as unknown as Env;
});
afterAll(async () => {
  await mf?.dispose();
});
const get = (path: string, method = "GET") =>
  handleRequest(new Request(`https://local.example${path}`, { method }), env);
const list = async (query = "") =>
  ListSchema.parse(await (await get(`/api/opportunities${query}`)).json());

describe("public API against real local D1", () => {
  it("seeds idempotently and lists only approved public metadata", async () => {
    const result = await list();
    expect(result.total).toBe(8);
    expect(result.items).toHaveLength(8);
    expect(result.items[0].id).toBe("phd-embodied-ai");
    const body = JSON.stringify(result);
    for (const privateValue of [
      "PRIVATE REVIEW",
      "mime_sha256",
      "r2_key",
      "quote",
      "actor_id",
      "permission_policies",
    ])
      expect(body).not.toContain(privateValue);
    expect(
      result.items.every((o) => o.state === "published" && o.synthetic),
    ).toBe(true);
    expect(
      result.items.find((o) => o.id === "engineer-secure-software")
        ?.applicationDeadline,
    ).toBeNull();
  });
  it("returns detail with multiple topics and source references", async () => {
    const result = OpportunitySchema.parse(
      await (await get("/api/opportunities/phd-embodied-ai")).json(),
    );
    expect(result.topics.length).toBe(3);
    expect(result.sources[0].url).toMatch(/^https:\/\/example.org/);
    expect(result.compensation).toBe("Funded doctoral contract");
  });
  it.each(["draft", "pending_review", "rejected", "archived"])(
    "never exposes %s records by ID or search",
    async (state) => {
      await env.DB.prepare(
        "INSERT INTO opportunities (id,state,title,updated_at,description) VALUES (?,?,?,?,?)",
      )
        .bind(
          `hidden-${state.replace("_", "-")}`,
          state,
          "hidden-sentinel",
          "2026-10-19T00:00:00.000Z",
          "SECRET",
        )
        .run();
      expect(
        (await get(`/api/opportunities/hidden-${state.replace("_", "-")}`))
          .status,
      ).toBe(404);
      expect((await list("?q=hidden-sentinel")).total).toBe(0);
    },
  );
  it("combines type, topic, country, keyword, publication and deadline filters", async () => {
    const q = new URLSearchParams({
      q: "robots",
      type: "PhD",
      topic: "Robotics & HRI",
      country: "France",
      publishedSince: "2026-10-19",
      deadlineBefore: "2026-12-15",
    });
    expect((await list(`?${q}`)).items.map((o) => o.id)).toEqual([
      "phd-embodied-ai",
    ]);
    expect((await list("?publishedSince=2026-10-20")).total).toBe(0);
    expect((await list("?country=Germany&type=PhD")).total).toBe(0);
  });
  it("treats unknown deadlines explicitly and includes the cutoff date", async () => {
    expect((await list("?deadlineBefore=2026-12-15")).total).toBe(3);
    expect(
      (await list("?deadlineBefore=2026-12-15&includeUnknownDeadline=true"))
        .total,
    ).toBe(5);
  });
  it("paginates stably without duplicate records", async () => {
    const a = await list("?limit=3"),
      b = await list("?limit=3&page=2");
    expect(a.total).toBe(8);
    expect(a.items.length).toBe(3);
    expect(b.page).toBe(2);
    expect(new Set([...a.items, ...b.items].map((o) => o.id)).size).toBe(6);
    expect((await list("?page=999")).items).toEqual([]);
  });
  it.each([
    "?page=0",
    "?limit=10000",
    "?publishedSince=2026-02-30",
    "?type=wizard",
    "?deadlineBefore=tomorrow",
    "?admin=true",
    "?page=1&page=2",
    "?q=" + "a".repeat(201),
  ])("rejects invalid or ambiguous filters %s", async (query) => {
    expect((await get("/api/opportunities" + query)).status).toBe(400);
  });
  it("parameterizes queries and treats LIKE wildcards as literal search text", async () => {
    expect((await list("?q=" + encodeURIComponent("' OR 1=1 --"))).total).toBe(
      0,
    );
    expect((await list("?q=%25")).total).toBe(0);
  });
  it("fails closed for administration, write methods and unknown APIs", async () => {
    expect((await get("/api/admin")).status).toBe(403);
    expect((await get("/admin")).status).toBe(403);
    expect((await get("/api/admin/jobs", "POST")).status).toBe(403);
    const response = await get("/api/opportunities", "POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect((await get("/api/raw-mails")).status).toBe(404);
    expect((await get("/api/opportunities/missing")).status).toBe(404);
  });
  it("serves only published countries as facets", async () => {
    await env.DB.prepare(
      "UPDATE opportunities SET country='Private Country' WHERE id='private-review'",
    ).run();
    const facets = (await (await get("/api/facets")).json()) as {
      countries: string[];
    };
    expect(facets.countries).toContain("France");
    expect(facets.countries).not.toContain("Private Country");
  });
  it("fails safely if an approved row contains an unsafe link", async () => {
    await env.DB.prepare(
      "UPDATE opportunities SET application_url='javascript:alert(1)' WHERE id='postdoc-visual-computing'",
    ).run();
    const response = await get("/api/opportunities/postdoc-visual-computing");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("javascript:");
    await env.DB.prepare(
      "UPDATE opportunities SET application_url=NULL WHERE id='postdoc-visual-computing'",
    ).run();
  });
  it("adds security headers to assets and API responses", async () => {
    for (const path of [
      "/opportunities/phd-embodied-ai",
      "/api/opportunities",
    ]) {
      const response = await get(path);
      expect(response.headers.get("content-security-policy")).toContain(
        "object-src 'none'",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
  it("rejects published records without critical projection fields in D1", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO opportunities (id,state,updated_at) VALUES ('incomplete','published','2026-10-19T00:00:00.000Z')",
      ).run(),
    ).rejects.toThrow();
  });
});
