// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { opportunities } from "../src/catalogue";

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
  it("opens the sources page, supports direct links, and returns to offers", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Sources" }));
    expect(window.location.pathname).toBe("/sources");
    expect(screen.getByRole("heading", { name: "Mailing lists" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /CHI-JOBS/ }).getAttribute("href"),
    ).toBe("https://sigchi.org/operations/listserv/");
    expect(
      screen.queryByRole("heading", { name: /opportunities$/ }),
    ).toBeNull();
    cleanup();
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Vacancy websites" }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("link", { name: /All opportunities/ }));
    expect(
      screen.getByRole("heading", {
        name: `${opportunities.length} opportunities`,
      }),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps multiple checked countries in the URL and clears them on reset", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("Country · All countries"));
    await user.click(screen.getByRole("checkbox", { name: "France" }));
    await user.click(screen.getByRole("checkbox", { name: "Germany" }));
    expect(
      new URLSearchParams(window.location.search).getAll("country"),
    ).toEqual(["France", "Germany"]);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "France",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Germany",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    await user.click(screen.getByRole("link", { name: "Reset" }));
    expect(
      (
        screen.getByRole("checkbox", {
          name: "France",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(window.location.search).toBe("");
  });
  it("lists real offers, opens details, and returns without a server", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", {
      name: `${opportunities.length} opportunities`,
    });
    const title = screen.getAllByRole("heading", { level: 3 })[0];
    await user.click(within(title).getByRole("link"));
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
