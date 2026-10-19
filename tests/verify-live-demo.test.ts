import { describe, it, expect, vi } from "vitest";
import { demoUrl, verifyLiveDemo } from "../scripts/verify-live-demo.mjs";
const base = demoUrl("sample-account");
const fixture = (index: number) => ({
  id: index === 0 ? "phd-embodied-ai" : `opportunity-${index}`,
  title: "Synthetic role",
  jobType: index === 1 ? "Internship" : "PhD",
  organization: "Fictional Institute",
  laboratory: null,
  country: "France",
  city: null,
  topics: [],
  duration: null,
  compensation: null,
  startDate: null,
  applicationDeadline: null,
  contact: null,
  applicationUrl: null,
  description: "A fictional role.",
  state: "published",
  publicationFormat: "summary",
  publishedAt: "2026-10-19T00:00:00.000Z",
  updatedAt: "2026-10-19T00:00:00.000Z",
  synthetic: true,
  sources: [],
});
function mockRequest(override: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string, options: any) => {
    const u = new URL(url);
    const key = options.method + " " + u.pathname + u.search;
    if (override[key]) return override[key]();
    if (u.pathname === "/api/health") return Response.json({ status: "ok" });
    if (key === "GET /api/opportunities")
      return Response.json({
        items: Array.from({ length: 8 }, (_, i) => fixture(i)),
        total: 8,
        page: 1,
        limit: 12,
      });
    if (key === "GET /api/opportunities?type=Internship&country=France")
      return Response.json({
        items: [fixture(1)],
        total: 1,
        page: 1,
        limit: 12,
      });
    if (key === "GET /api/opportunities/phd-embodied-ai")
      return Response.json(fixture(0));
    if (key === "POST /api/opportunities")
      return Response.json({}, { status: 405 });
    if (u.pathname === "/api/admin") return Response.json({}, { status: 403 });
    if (
      ["/api/raw-mails", "/api/opportunities/private-review"].includes(
        u.pathname,
      )
    )
      return Response.json({}, { status: 404 });
    if (u.pathname.startsWith("/assets/")) return new Response("app");
    return new Response(
      '<html><div id="root"></div><script src="/assets/app.js"></script></html>',
      {
        headers: {
          "Content-Type": "text/html",
          "Content-Security-Policy": "object-src 'none'",
        },
      },
    );
  });
}
describe("public demo acceptance checks", () => {
  it("checks the public SPA/API without sending Cloudflare credentials", async () => {
    const request = mockRequest();
    await expect(
      verifyLiveDemo(base, { request, wait: async () => {} }),
    ).resolves.toBe(base);
    expect(
      request.mock.calls.every(
        ([, options]) => !options.headers && options.redirect === "error",
      ),
    ).toBe(true);
  });
  it.each([
    "https://evil.example",
    "https://academic-opportunities-demo.a.workers.dev/path",
    "http://academic-opportunities-demo.a.workers.dev",
    "https://academic-opportunities.a.workers.dev",
  ])("rejects an unexpected target %s before fetching", async (url) => {
    const request = mockRequest();
    await expect(verifyLiveDemo(url, { request })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects malformed account subdomains before deployment", () => {
    expect(() => demoUrl("https://sample.workers.dev")).toThrow();
    expect(() => demoUrl("")).toThrow();
  });
  it("does not accept a public non-synthetic record", async () => {
    const request = mockRequest({
      "GET /api/opportunities": () =>
        Response.json({
          items: [
            { ...fixture(0), synthetic: false },
            ...Array.from({ length: 7 }, (_, i) => fixture(i + 1)),
          ],
          total: 8,
          page: 1,
          limit: 12,
        }),
    });
    await expect(verifyLiveDemo(base, { request })).rejects.toThrow();
  });
  it("does not report success when private review records are exposed", async () => {
    const request = mockRequest({
      "GET /api/opportunities/private-review": () => Response.json(fixture(0)),
    });
    await expect(verifyLiveDemo(base, { request })).rejects.toThrow();
  });
  it("refuses off-origin script assets", async () => {
    const request = mockRequest({
      "GET /": () =>
        new Response(
          '<div id="root"></div><script src="https://evil.example/app.js"></script>',
          {
            headers: {
              "Content-Type": "text/html",
              "Content-Security-Policy": "object-src 'none'",
            },
          },
        ),
    });
    await expect(verifyLiveDemo(base, { request })).rejects.toThrow();
    expect(request.mock.calls.every(([url]) => url.startsWith(base))).toBe(
      true,
    );
  });
});
