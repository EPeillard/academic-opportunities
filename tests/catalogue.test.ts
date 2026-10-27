import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpportunitySchema } from "../src/schema";
import {
  deadlinePassed,
  opportunities,
  listOpportunities,
  getOpportunity,
} from "../src/catalogue";

function list(query = "") {
  const result = listOpportunities(new URLSearchParams(query), "2026-10-27");
  if (!("items" in result)) throw new Error("Expected list");
  return result;
}
describe("static catalogue", () => {
  it("combines checked countries with OR and other filters with AND", () => {
    const france = list("?country=France&type=PhD");
    const germany = list("?country=Germany&type=PhD");
    const both = list("?country=France&country=Germany&type=PhD&limit=50");
    expect(both.total).toBe(france.total + germany.total);
    expect(
      both.items.every(
        (o) =>
          o.jobType === "PhD" &&
          ["France", "Germany"].includes(o.country ?? ""),
      ),
    ).toBe(true);
    expect(() => list("?country=")).toThrow(/filters/);
  });
  it("validates the entire public dataset and rejects private email fields", () => {
    expect(z.array(OpportunitySchema).parse(opportunities)).toHaveLength(
      opportunities.length,
    );
    expect(new Set(opportunities.map((o) => o.id)).size).toBe(
      opportunities.length,
    );
    for (const item of opportunities) {
      expect(item.sources.length).toBeGreaterThan(0);
      expect(
        OpportunitySchema.safeParse({ ...item, rawMime: "private" }).success,
      ).toBe(false);
      expect(JSON.stringify(item)).not.toMatch(
        /unsubscribe|auto_signoff|Message-ID|Content-Type:|example\.org/i,
      );
    }
  });
  it("combines filters and searches the complete catalogue before pagination", () => {
    const result = list("?type=PhD&country=France&q=interaction&limit=50");
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.jobType).toBe("PhD");
      expect(item.country).toBe("France");
      expect(
        [item.title, item.organization, item.laboratory, item.description]
          .join(" ")
          .toLowerCase(),
      ).toContain("interaction");
    }
    const page1 = list("?limit=10");
    const page2 = list("?limit=10&page=2");
    expect(page1.total).toBe(opportunities.length);
    expect(page2.total).toBe(page1.total);
    expect(
      page2.items.some((o) => page1.items.some((p) => p.id === o.id)),
    ).toBe(false);
    expect(page1.items[0].publishedAt >= page2.items[0].publishedAt).toBe(true);
    expect(list("?q=%25_%25").total).toBe(0);
  });
  it("handles deadline cutoffs, unknown dates, and historical offers independently", () => {
    const known = list("?deadlineBefore=2026-10-27&limit=50");
    expect(
      known.items.every(
        (o) => o.applicationDeadline && o.applicationDeadline <= "2026-10-27",
      ),
    ).toBe(true);
    const withUnknown = list(
      "?deadlineBefore=2026-10-27&includeUnknownDeadline=true",
    );
    expect(withUnknown.total).toBeGreaterThan(known.total);
    expect(
      list("?deadlineStatus=past&limit=50").items.every(
        (o) => o.applicationDeadline && o.applicationDeadline < "2026-10-27",
      ),
    ).toBe(true);
    expect(
      list("?deadlineStatus=upcoming&limit=50").items.every(
        (o) => o.applicationDeadline && o.applicationDeadline >= "2026-10-27",
      ),
    ).toBe(true);
    expect(deadlinePassed(null, "2026-10-27")).toBe(false);
    expect(deadlinePassed("2026-10-27", "2026-10-27")).toBe(false);
    expect(deadlinePassed("2026-10-26", "2026-10-27")).toBe(true);
  });
  it("rejects invalid, unknown, repeated and impossible URL parameters", () => {
    for (const query of [
      "?type=invalid",
      "?page=0",
      "?limit=51",
      "?q=a&q=b",
      "?admin=true",
      "?deadlineBefore=2026-02-30",
      "?deadlineStatus=open",
    ]) {
      expect(() => list(query)).toThrow(/filters/);
    }
  });
  it("opens every detail and rejects unknown IDs", () => {
    for (const item of opportunities)
      expect(getOpportunity(item.id)).toEqual(item);
    expect(() => getOpportunity("nonexistent")).toThrow(/not be found/);
    expect(list("?page=1000").items).toEqual([]);
  });
  it("keeps real split vacancies searchable under their own position types", () => {
    const microsoft = list("?q=Microsoft&type=Internship");
    expect(
      microsoft.items.filter((o) => o.organization === "Microsoft Research"),
    ).toHaveLength(2);
    const epfl = opportunities.find((o) => o.organization === "EPFL");
    expect(epfl?.applicationDeadline).toBe("2026-12-15");
    expect(epfl?.description).toContain("weightlessness");
    const priority = opportunities.find((o) =>
      o.title.includes("Computational Linguistics"),
    );
    expect(priority?.applicationDeadline).toBeNull();
    expect(priority?.description).toContain("Priority");
  });
});
