import { describe, expect, it } from "vitest";
import manifest from "../data/import-afxr-2026-10-27.json";
import { opportunities, deadlinePassed } from "../src/catalogue";

const byId = new Map(opportunities.map((offer) => [offer.id, offer]));
describe("AFXR 2026 import", () => {
  it("accounts for every 2026 article across both listing pages", () => {
    expect(manifest.articles.length).toBe(30);
    expect(new Set(manifest.articles.map((article) => article.url)).size).toBe(
      30,
    );
    for (const article of manifest.articles) {
      expect(article.publishedAt).toMatch(/^2026-/);
      expect(article.opportunityIds.length).toBeGreaterThan(0);
      for (const id of article.opportunityIds) {
        const offer = byId.get(id)!;
        expect(offer).toBeTruthy();
        expect(offer.sources.some((source) => source.url === article.url)).toBe(
          true,
        );
      }
    }
    const added = manifest.articles
      .filter((article) => article.action === "added")
      .flatMap((article) => article.opportunityIds);
    const enriched = new Set(
      manifest.articles
        .filter((article) => article.action === "enriched")
        .flatMap((article) => article.opportunityIds),
    );
    expect(new Set(added).size).toBe(15);
    expect(enriched.size).toBe(21);
  });
  it("keeps distinct subjects separate and merges relances into the same offer", () => {
    const relances = manifest.articles.filter((article) =>
      ["209836", "218162"].includes(article.articleId),
    );
    expect(relances[0].opportunityIds).toEqual(relances[1].opportunityIds);
    const inspire = opportunities.filter((offer) =>
      offer.id.startsWith("afxr-219955-"),
    );
    expect(inspire.length).toBe(3);
    expect(inspire.filter((offer) => offer.jobType === "Postdoc").length).toBe(
      2,
    );
    expect(
      inspire.filter((offer) => offer.jobType === "Research Engineer").length,
    ).toBe(1);
    expect(
      new Set(
        inspire.flatMap((offer) =>
          offer.attachments.map((attachment) => attachment.url),
        ),
      ).size,
    ).toBe(1);
    const xai = byId.get("afxr-219958-graph-xai")!;
    const statistics = byId.get("afxr-219958-anomalies-statistiques")!;
    expect(xai.attachments[0].name).toMatch(/-2\.pdf$/);
    expect(statistics.attachments[0].url).not.toBe(xai.attachments[0].url);
  });
  it("preserves uncertain dates and the explicit filled-offer notice", () => {
    const sketch = byId.get("afxr-222039-sketch2space")!;
    expect(sketch.publishedAt).toMatch(/^2026-10-27/);
    expect(sketch.startDate).toBeNull();
    expect(sketch.description).toContain("février et août 2027");
    expect(
      byId.get("afxr-212191-chaire-lispen")!.applicationDeadline,
    ).toBeNull();
    const expired = byId.get("afxr-200580-cexi-ha")!;
    expect(expired.applicationDeadline).toBe("2026-02-20");
    expect(deadlinePassed(expired.applicationDeadline, "2026-10-27")).toBe(
      true,
    );
    const filled = opportunities.find((offer) =>
      offer.id.startsWith("offre-de-stage-m2-ra-patrimoine-au-lisn-"),
    )!;
    expect(filled.description).toContain("pourvue");
  });
});
