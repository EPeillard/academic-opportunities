// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../apps/web/src/App";
import { JOB_TYPES, TOPICS } from "../packages/shared/src";
const fixture = {
  id: "sample-role",
  title: "Research internship in robotics",
  jobType: "Internship",
  organization: "Fictional Institute",
  laboratory: null,
  country: "France",
  city: "Nantes",
  topics: ["Robotics & HRI"],
  duration: "6 months",
  compensation: null,
  startDate: null,
  applicationDeadline: null,
  contact: null,
  applicationUrl: "https://example.org/jobs/sample",
  description: "A synthetic research opportunity.",
  state: "published",
  publicationFormat: "summary",
  publishedAt: "2026-10-19T00:00:00.000Z",
  updatedAt: "2026-10-19T00:00:00.000Z",
  synthetic: true,
  sources: [
    {
      label: "Synthetic list",
      url: "https://example.org/source",
      receivedAt: "2026-10-19T00:00:00.000Z",
    },
  ],
};
let calls: string[];
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  calls = [];
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      calls.push(path);
      if (path === "/api/facets")
        return Response.json({
          countries: ["France"],
          types: JOB_TYPES,
          topics: TOPICS,
        });
      if (path === "/api/opportunities/sample-role")
        return Response.json(fixture);
      return Response.json({ items: [fixture], total: 1, page: 1, limit: 12 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("public browsing", () => {
  it("opens details, shows unknown fields, and supports returning to results", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: fixture.title });
    await user.click(screen.getByRole("link", { name: /View opportunity/ }));
    await screen.findByRole("heading", { name: "About the opportunity" });
    expect(window.location.pathname).toBe("/opportunities/sample-role");
    expect(screen.getAllByText("Not specified").length).toBeGreaterThan(2);
    const source = screen.getByRole("link", { name: /Synthetic list/ });
    expect(source.getAttribute("rel")).toContain("noopener");
    await user.click(screen.getByRole("link", { name: /All opportunities/ }));
    await screen.findByRole("heading", { name: "1 opportunities" });
  });
  it("submits combined filters to the API and bookmark URL", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: fixture.title });
    await user.type(screen.getByLabelText("Keywords"), "robot");
    await user.selectOptions(
      screen.getByLabelText("Position type"),
      "Internship",
    );
    await user.selectOptions(screen.getByLabelText("Country"), "France");
    await user.click(
      screen.getByRole("button", { name: /Find opportunities/ }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (path) =>
            path.includes("q=robot") &&
            path.includes("type=Internship") &&
            path.includes("country=France"),
        ),
      ).toBe(true),
    );
    expect(window.location.search).toContain("q=robot");
    await user.click(screen.getByRole("link", { name: "Reset" }));
    await waitFor(() => expect(window.location.search).toBe(""));
  });
  it("renders malicious-looking text without interpreting HTML", async () => {
    window.history.replaceState(null, "", "/opportunities/sample-role");
    vi.stubGlobal("fetch", async (path: string) =>
      Response.json(
        path === "/api/facets"
          ? { countries: [], types: JOB_TYPES, topics: TOPICS }
          : { ...fixture, description: '<img src=x onerror="alert(1)">' },
      ),
    );
    const { container } = render(<App />);
    await screen.findByText('<img src=x onerror="alert(1)">');
    expect(container.querySelector("img")).toBeNull();
  });
  it("shows an empty state and can recover from API failure", async () => {
    let failed = true;
    vi.stubGlobal("fetch", async (path: string) =>
      path === "/api/facets"
        ? Response.json({ countries: [], types: JOB_TYPES, topics: TOPICS })
        : failed
          ? Response.json({ error: "unavailable" }, { status: 500 })
          : Response.json({ items: [], total: 0, page: 1, limit: 12 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("alert");
    failed = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("No opportunities match these filters.");
  });
});
