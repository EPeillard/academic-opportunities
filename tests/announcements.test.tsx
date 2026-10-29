// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import {
  AnnouncementDocumentSchema,
  AnnouncementLinkSchema,
} from "../src/schema";
import { AnnouncementText, Announcements } from "../src/Announcements";
import { opportunities } from "../src/catalogue";

afterEach(cleanup);
const incubatorUrl =
  "https://www.demogr.mpg.de/en/career_6122/jobs_fellowships_1910/population_and_social_data_science_summer_incubator_program_15806";
const incubator = opportunities.find(
  (offer) => offer.applicationUrl === incubatorUrl,
)!;

describe("original announcement details", () => {
  it("loads the full Max Planck invitation with its original website link", async () => {
    expect(incubator).toBeTruthy();
    render(<Announcements references={incubator.announcements} />);
    const link = await screen.findByRole("link", { name: incubatorUrl });
    expect(link.getAttribute("href")).toBe(incubatorUrl);
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(
      screen.getByText(
        /The Max Planck Institute for Demographic Research.*inviting applications/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /enable discovery by bringing together data scientists and population scientists/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/June 1st – August 20th, 2027/)).toBeTruthy();
    expect(screen.getByText("Announced 15 October 2026")).toBeTruthy();
  });
  it("renders source markup as text and accepts only web or recruitment email links", () => {
    render(
      <AnnouncementText
        document={{
          parts: [
            { text: '<img src=x onerror="alert(1)"><script>alert(1)</script>' },
            { text: "Contact the team", href: "mailto:jobs@university.edu" },
          ],
        }}
      />,
    );
    expect(document.querySelector("img, script")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Contact the team" })
        .getAttribute("href"),
    ).toBe("mailto:jobs@university.edu");
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "https://user:pass@university.edu/",
      "http://127.0.0.1/",
      "mailto:jobs@university.edu?bcc=private@example.org",
      "mailto:jobs@university.edu%0Abcc:private@example.org",
    ]) {
      expect(AnnouncementLinkSchema.safeParse(url).success).toBe(false);
    }
    expect(
      AnnouncementLinkSchema.safeParse("http://research.university.edu/project")
        .success,
    ).toBe(true);
  });
  it("covers every available body and keeps shared documents consistent", () => {
    expect(
      opportunities.filter((offer) => offer.announcements.length).length,
    ).toBe(432);
    const ids = new Set(
      opportunities.flatMap((offer) =>
        offer.announcements.map((ref) => ref.id),
      ),
    );
    expect(ids.size).toBe(408);
    for (const id of ids) {
      const source = JSON.parse(
        readFileSync(`data/announcements/${id}.json`, "utf8"),
      );
      const doc = AnnouncementDocumentSchema.parse(source);
      expect(doc.parts.map((part) => part.text).join("")).not.toMatch(
        /unsubscribe|auto_signoff|listserv\.acm|\ufffd/i,
      );
    }
  });
  it("does not repeat identical relances or render a section for absent bodies", async () => {
    const reference = incubator.announcements[0];
    const { unmount } = render(
      <Announcements references={[reference, reference]} />,
    );
    await screen.findByRole("link", { name: incubatorUrl });
    expect(document.querySelectorAll(".announcement-text").length).toBe(1);
    expect(screen.queryByText(/Earlier announcement/)).toBeNull();
    unmount();
    render(<Announcements references={[]} />);
    expect(
      screen.queryByRole("region", { name: "Announcement details" }),
    ).toBeNull();
  });
});
