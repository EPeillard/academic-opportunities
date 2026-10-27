// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AttachmentSchema } from "../src/schema";
import { PositionDocuments } from "../src/PositionDocuments";
import { opportunities } from "../src/catalogue";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

afterEach(cleanup);
describe("position document attachments", () => {
  it("opens publisher-hosted PDFs with a clear format and source link", () => {
    const attachment = opportunities
      .flatMap((offer) => offer.attachments)
      .find((attachment) => attachment.url.startsWith("https://"))!;
    expect(AttachmentSchema.safeParse(attachment).success).toBe(true);
    render(<PositionDocuments attachments={[attachment]} />);
    const link = screen.getByRole("link", { name: `Open ${attachment.name}` });
    expect(link.getAttribute("href")).toBe(attachment.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.hasAttribute("download")).toBe(false);
    expect(screen.getByText(/PDF ·/)).toBeTruthy();
  });
  it("provides original filenames and working download links even without an email body", () => {
    const offer = opportunities.find(
      (offer) =>
        !offer.announcements.length &&
        offer.attachments.some((attachment) =>
          attachment.url.startsWith("/documents/"),
        ),
    )!;
    expect(offer).toBeTruthy();
    render(<PositionDocuments attachments={offer.attachments} />);
    const attachment = offer.attachments[0];
    const open = screen.getByRole("link", { name: attachment.name });
    const download = screen.getByRole("link", {
      name: `Download ${attachment.name}`,
    });
    expect(open.getAttribute("href")).toBe(attachment.url);
    expect(download.getAttribute("href")).toBe(attachment.url);
    expect(download.getAttribute("download")).toBe(attachment.name);
    expect(screen.getByText(/PDF ·/)).toBeTruthy();
  });
  it("preserves original file bytes and deduplicates files across relances", () => {
    expect(
      opportunities.filter((offer) =>
        offer.attachments.some((attachment) =>
          attachment.url.startsWith("/documents/"),
        ),
      ).length,
    ).toBe(76);
    const documents = new Map(
      opportunities.flatMap((offer) =>
        offer.attachments
          .filter((attachment) => attachment.url.startsWith("/documents/"))
          .map((attachment) => [attachment.url, attachment] as const),
      ),
    );
    expect(documents.size).toBe(79);
    expect(
      [...documents.keys()].filter((url) => url.endsWith(".pdf")).length,
    ).toBe(75);
    for (const [url, attachment] of documents) {
      const bytes = readFileSync(`public${url}`);
      expect(bytes.length).toBe(attachment.size);
      expect(url).toContain(
        createHash("sha256").update(bytes).digest("hex").slice(0, 24),
      );
    }
  });
  it("rejects executable attachments and paths outside public position documents", () => {
    const attachment = opportunities.flatMap((offer) => offer.attachments)[0];
    for (const url of [
      "/documents/../../private.eml",
      "http://localhost/private.pdf",
      "/documents/123.exe",
    ]) {
      expect(AttachmentSchema.safeParse({ ...attachment, url }).success).toBe(
        false,
      );
    }
    render(<PositionDocuments attachments={[]} />);
    expect(
      screen.queryByRole("region", { name: "Position documents" }),
    ).toBeNull();
  });
  it("keeps the different subjects of a collective announcement on their respective offers", () => {
    const roles = opportunities.filter((offer) =>
      offer.id.startsWith("deux-offres-de-cdds-au-lastig"),
    );
    expect(roles.length).toBe(2);
    for (const offer of roles) {
      expect(offer.attachments.length).toBe(1);
      expect(offer.attachments[0].name).toContain(
        offer.jobType === "Postdoc" ? "post-doc_ontologie" : "devops_dataops",
      );
    }
  });
});
