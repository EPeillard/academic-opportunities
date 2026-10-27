// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../apps/web/src/App";
import { opportunities } from "../apps/web/src/catalogue";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Browsing must not call an API");
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("static public browsing", () => {
  it("lists real offers, opens details, and returns without a server", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", {
      name: `${opportunities.length} opportunities`,
    });
    expect(screen.queryByText(/SYNTHETIC DEMO/)).toBeNull();
    await user.click(
      screen.getAllByRole("link", { name: /View opportunity/ })[0],
    );
    await screen.findByRole("heading", { name: "About the opportunity" });
    expect(window.location.pathname).toMatch(/^\/opportunities\//);
    await user.click(screen.getByRole("link", { name: /All opportunities/ }));
    await screen.findByRole("heading", {
      name: `${opportunities.length} opportunities`,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("combines bookmarked filters, shows empty results, and resets", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", {
      name: `${opportunities.length} opportunities`,
    });
    await user.type(
      screen.getByLabelText("Keywords"),
      "impossible-vacancy-zzzz",
    );
    await user.selectOptions(screen.getByLabelText("Position type"), "PhD");
    await user.click(
      screen.getByRole("button", { name: /Find opportunities/ }),
    );
    await screen.findByText("No opportunities match these filters.");
    expect(window.location.search).toContain("type=PhD");
    expect(window.location.search).toContain("q=impossible-vacancy-zzzz");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    await screen.findByRole("heading", {
      name: `${opportunities.length} opportunities`,
    });
  });
  it("handles invalid bookmarks and unknown paths", async () => {
    window.history.replaceState(null, "", "/?page=0");
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("filters");
    cleanup();
    window.history.replaceState(null, "", "/private-email");
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "page could not be found",
    );
  });
  it("marks expired offers and provides genuine vacancy links", async () => {
    const expired = opportunities.find(
      (o) => o.applicationDeadline === "2026-02-28" && o.applicationUrl,
    )!;
    window.history.replaceState(null, "", `/opportunities/${expired.id}`);
    render(<App />);
    await screen.findByRole("heading", { name: expired.title });
    expect(screen.getByText(/announced deadline has passed/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /View vacancy & apply/ });
    expect(link.getAttribute("href")).toBe(expired.applicationUrl);
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
