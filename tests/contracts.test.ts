import { describe, it, expect } from "vitest";
import {
  DateSchema,
  ExtractedFieldsSchema,
  PermissionCheckSchema,
  PublicUrlSchema,
  QuerySchema,
  ExtractionSchema,
} from "../packages/shared/src";

describe("untrusted input contracts", () => {
  it("retains missing extracted values without guessing", () => {
    const fields = ExtractedFieldsSchema.parse({
      title: null,
      jobType: null,
      organization: null,
      laboratory: null,
      country: null,
      city: null,
      topics: [],
      duration: null,
      compensation: null,
      startDate: null,
      applicationDeadline: null,
      contact: null,
      applicationUrl: null,
      description: null,
    });
    expect(fields.organization).toBeNull();
    expect(fields.applicationDeadline).toBeNull();
    expect(
      ExtractionSchema.parse({
        schemaVersion: 1,
        provider: "fake",
        model: "fixture",
        candidates: [],
      }).candidates,
    ).toEqual([]);
    expect(
      ExtractionSchema.safeParse({
        schemaVersion: 1,
        provider: "fake",
        model: "fixture",
        candidates: [{ fields, evidence: [], confidence: 2 }],
      }).success,
    ).toBe(false);
  });
  it.each([
    "javascript:alert(1)",
    "http://example.org",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://example.org@localhost/a",
    "https://user:pass@example.org",
    "https://a.internal/",
    "https://example.org:8787/a",
  ])("rejects unsafe public URL %s", (value) => {
    expect(PublicUrlSchema.safeParse(value).success).toBe(false);
  });
  it("accepts public HTTPS links and real calendar dates only", () => {
    expect(PublicUrlSchema.parse("https://example.org/jobs/1")).toContain(
      "/jobs/1",
    );
    expect(DateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(QuerySchema.safeParse({ page: "-1" }).success).toBe(false);
    expect(QuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });
  it("requires independent policy evidence for full-text permission", () => {
    expect(
      PermissionCheckSchema.safeParse({
        decision: "authorized_full_text",
        policyId: null,
        reason: "model says yes",
        checkedAt: "2026-10-19T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
