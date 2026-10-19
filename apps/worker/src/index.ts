import {
  FacetsSchema,
  JOB_TYPES,
  ListSchema,
  OpportunitySchema,
  QuerySchema,
  TOPICS,
} from "@academic/shared";
import type { Opportunity } from "@academic/shared";
export interface Env {
  APP_ENV?: "local" | "production" | "demo";
  DB: D1Database;
  ASSETS: Fetcher;
}

const columns = `id, title, job_type, organization, laboratory, country, city, duration,
 compensation, start_date, application_deadline, contact, application_url,
 description, publication_format, published_at, updated_at, synthetic`;
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { ...securityHeaders, "Cache-Control": "no-store", ...extra },
  });
}
async function hydrate(
  db: D1Database,
  rows: Record<string, unknown>[],
): Promise<Opportunity[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const placeholders = ids.map(() => "?").join(",");
  const [topics, sources] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT opportunity_id,topic FROM opportunity_topics WHERE opportunity_id IN (${placeholders}) ORDER BY topic`,
      )
      .bind(...ids),
    db
      .prepare(
        `SELECT opportunity_id,label,public_url,received_at FROM public_sources WHERE opportunity_id IN (${placeholders}) ORDER BY received_at,id`,
      )
      .bind(...ids),
  ]);
  return rows.map((r) =>
    OpportunitySchema.parse({
      id: r.id,
      title: r.title,
      jobType: r.job_type,
      organization: r.organization,
      laboratory: r.laboratory,
      country: r.country,
      city: r.city,
      duration: r.duration,
      compensation: r.compensation,
      startDate: r.start_date,
      applicationDeadline: r.application_deadline,
      contact: r.contact,
      applicationUrl: r.application_url,
      description: r.description,
      publicationFormat: r.publication_format,
      publishedAt: r.published_at,
      updatedAt: r.updated_at,
      synthetic: r.synthetic === 1,
      state: "published",
      topics: topics.results
        .filter((t) => t.opportunity_id === r.id)
        .map((t) => t.topic),
      sources: sources.results
        .filter((s) => s.opportunity_id === r.id)
        .map((s) => ({
          label: s.label,
          url: s.public_url,
          receivedAt: s.received_at,
        })),
    }),
  );
}
export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const publicationScope =
    env.APP_ENV === "demo"
      ? "state='published' AND synthetic=1"
      : "state='published'";
  if (
    url.pathname === "/admin" ||
    url.pathname.startsWith("/admin/") ||
    url.pathname === "/api/admin" ||
    url.pathname.startsWith("/api/admin/")
  )
    return json(
      { error: "Administration is not available in Milestone 1" },
      403,
    );
  if (!url.pathname.startsWith("/api/")) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(securityHeaders))
      headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
  if (request.method !== "GET")
    return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  try {
    if (url.pathname === "/api/health")
      return json({ status: "ok", milestone: 1 });
    if (url.pathname === "/api/facets") {
      const countries = await env.DB.prepare(
        `SELECT DISTINCT country FROM opportunities WHERE ${publicationScope} AND country IS NOT NULL ORDER BY country`,
      ).all<{ country: string }>();
      return json(
        FacetsSchema.parse({
          countries: countries.results.map((r) => r.country),
          types: JOB_TYPES,
          topics: TOPICS,
        }),
      );
    }
    if (url.pathname === "/api/opportunities") {
      const parsed = QuerySchema.safeParse(
        Object.fromEntries(url.searchParams),
      );
      if (!parsed.success)
        return json(
          {
            error: "Invalid filters",
            details: parsed.error.issues.map((i) => ({
              field: i.path.join("."),
              message: i.message,
            })),
          },
          400,
        );
      // Repeated parameters are ambiguous: reject instead of silently selecting one.
      if (
        [...url.searchParams.keys()].some(
          (key) => url.searchParams.getAll(key).length > 1,
        )
      )
        return json({ error: "Repeated filters are not supported" }, 400);
      const q = parsed.data,
        where = [publicationScope],
        values: (string | number)[] = [];
      if (q.q) {
        where.push(
          "(title LIKE ? ESCAPE '\\' OR organization LIKE ? ESCAPE '\\' OR laboratory LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')",
        );
        const term = `%${q.q.replace(/[\\%_]/g, "\\$&")}%`;
        values.push(term, term, term, term);
      }
      if (q.type) {
        where.push("job_type=?");
        values.push(q.type);
      }
      if (q.country) {
        where.push("country=?");
        values.push(q.country);
      }
      if (q.topic) {
        where.push(
          "EXISTS (SELECT 1 FROM opportunity_topics t WHERE t.opportunity_id=opportunities.id AND t.topic=?)",
        );
        values.push(q.topic);
      }
      if (q.publishedSince) {
        where.push("published_at>=?");
        values.push(`${q.publishedSince}T00:00:00.000Z`);
      }
      if (q.deadlineBefore) {
        where.push(
          q.includeUnknownDeadline === "true"
            ? "(application_deadline<=? OR application_deadline IS NULL)"
            : "application_deadline<=?",
        );
        values.push(q.deadlineBefore);
      }
      const clause = where.join(" AND ");
      const [count, rows] = await env.DB.batch<Record<string, unknown>>([
        env.DB.prepare(
          `SELECT COUNT(*) AS total FROM opportunities WHERE ${clause}`,
        ).bind(...values),
        env.DB.prepare(
          `SELECT ${columns} FROM opportunities WHERE ${clause} ORDER BY published_at DESC,id LIMIT ? OFFSET ?`,
        ).bind(...values, q.limit, (q.page - 1) * q.limit),
      ]);
      return json(
        ListSchema.parse({
          items: await hydrate(env.DB, rows.results),
          total: count.results[0].total,
          page: q.page,
          limit: q.limit,
        }),
      );
    }
    const match = url.pathname.match(
      /^\/api\/opportunities\/([a-z0-9-]{1,100})$/,
    );
    if (match) {
      const row = await env.DB.prepare(
        `SELECT ${columns} FROM opportunities WHERE id=? AND ${publicationScope}`,
      )
        .bind(match[1])
        .first<Record<string, unknown>>();
      return row
        ? json((await hydrate(env.DB, [row]))[0])
        : json({ error: "Opportunity not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  } catch {
    // Do not log SQL, evidence, raw mail or private row contents.
    console.error(
      JSON.stringify({ event: "public_api_error", code: "READ_FAILED" }),
    );
    return json({ error: "Unable to load opportunities. Please retry." }, 500);
  }
}
export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
