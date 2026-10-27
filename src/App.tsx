import React, { useEffect, useMemo, useState } from "react";
import { JOB_TYPES, TOPICS } from "./schema";
import "./styles.css";
import { Announcements } from "./Announcements";
import { PositionDocuments } from "./PositionDocuments";
import { Sources } from "./Sources";
import {
  getFacets,
  getOpportunity,
  listOpportunities,
  deadlinePassed,
  updatedAt,
} from "./catalogue";

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Not specified";
const countries = getFacets().countries;
const currentLocation = () => window.location.pathname + window.location.search;
function useLocation() {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate = (path: string, filtering = false) => {
    if (filtering) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    setLocation(currentLocation());
    if (!filtering) window.scrollTo({ top: 0 });
  };
  return [location, navigate] as const;
}
function Link({
  href,
  navigate,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  navigate: (path: string) => void;
}) {
  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
}
export function App() {
  const [location, navigate] = useLocation();
  const url = new URL(location, window.location.origin),
    match = url.pathname.match(/^\/opportunities\/([a-z0-9-]+)$/),
    id = match?.[1];
  const sourcesPage = url.pathname === "/sources";
  const unknownPath = url.pathname !== "/" && !match && !sourcesPage;
  const { data, error } = useMemo(() => {
    try {
      if (unknownPath) throw new Error("This page could not be found.");
      return {
        data: sourcesPage
          ? null
          : id
            ? getOpportunity(id)
            : listOpportunities(url.searchParams),
        error: "",
      };
    } catch (e) {
      return {
        data: null,
        error:
          e instanceof Error ? e.message : "Unable to display opportunities.",
      };
    }
  }, [location]);
  const items = data && "items" in data ? data : null;
  const item = data && "title" in data ? data : null;
  function filter(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form))
      if (String(value).trim())
        params.append(key, key === "q" ? String(value) : String(value).trim());
    navigate(params.size ? `/?${params}` : "/", true);
  }
  const pager = (page: number) => {
    const p = new URLSearchParams(url.search);
    p.set("page", String(page));
    navigate(`/?${p}`);
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <div className="shell nav">
          <Link href="/" navigate={navigate} className="site-title">
            Research positions
          </Link>
          <nav className="site-links" aria-label="Main navigation">
            <Link
              href="/sources"
              navigate={navigate}
              aria-current={sourcesPage ? "page" : undefined}
            >
              Sources
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="shell">
        {!id && !unknownPath && !sourcesPage && (
          <div className="page-heading">
            <h1>Internships, PhDs and research jobs</h1>
            <p>Computer science and related fields.</p>
          </div>
        )}
        {(id || sourcesPage) && (
          <Link href="/" navigate={navigate} className="back">
            ← All opportunities
          </Link>
        )}
        {sourcesPage && <Sources />}
        {!id && !unknownPath && !sourcesPage && (
          <div className="content-grid">
            <aside>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  filter(event.currentTarget);
                }}
                className="filters"
              >
                <div className="filter-heading">
                  <h2>Filter offers</h2>
                  <Link href="/" navigate={navigate}>
                    Reset
                  </Link>
                </div>
                <label>
                  Keywords
                  <input
                    name="q"
                    placeholder="Title, lab, or keyword"
                    maxLength={200}
                    value={url.searchParams.get("q") ?? ""}
                    onChange={(event) => filter(event.currentTarget.form!)}
                  />
                </label>
                <label>
                  Position type
                  <select
                    name="type"
                    value={url.searchParams.get("type") ?? ""}
                    onChange={(event) => filter(event.currentTarget.form!)}
                  >
                    <option value="">All positions</option>
                    {JOB_TYPES.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Research topic
                  <select
                    name="topic"
                    value={url.searchParams.get("topic") ?? ""}
                    onChange={(event) => filter(event.currentTarget.form!)}
                  >
                    <option value="">All research areas</option>
                    {TOPICS.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <details className="country-filter">
                  <summary>
                    Country ·{" "}
                    {url.searchParams.getAll("country").join(", ") ||
                      "All countries"}
                  </summary>
                  <fieldset className="country-options">
                    <legend className="sr-only">Country</legend>
                    {countries.map((country) => (
                      <label key={country}>
                        <input
                          type="checkbox"
                          name="country"
                          value={country}
                          checked={url.searchParams
                            .getAll("country")
                            .includes(country)}
                          onChange={(event) =>
                            filter(event.currentTarget.form!)
                          }
                        />
                        {country}
                      </label>
                    ))}
                  </fieldset>
                </details>
                <details
                  className="advanced-filters"
                  open={Boolean(
                    url.searchParams.get("publishedSince") ||
                    url.searchParams.get("deadlineBefore") ||
                    (url.searchParams.get("deadlineStatus") &&
                      url.searchParams.get("deadlineStatus") !== "all"),
                  )}
                >
                  <summary>Dates and deadlines</summary>
                  <div className="advanced-fields">
                    <label>
                      Deadline status
                      <select
                        name="deadlineStatus"
                        value={url.searchParams.get("deadlineStatus") ?? "all"}
                        onChange={(event) => filter(event.currentTarget.form!)}
                      >
                        <option value="all">All announcements</option>
                        <option value="upcoming">Upcoming deadlines</option>
                        <option value="past">Past deadlines</option>
                      </select>
                    </label>
                    <label>
                      Announced on or after
                      <input
                        type="date"
                        name="publishedSince"
                        value={url.searchParams.get("publishedSince") ?? ""}
                        onChange={(event) => filter(event.currentTarget.form!)}
                      />
                    </label>
                    <label>
                      Deadline on or before
                      <input
                        type="date"
                        name="deadlineBefore"
                        value={url.searchParams.get("deadlineBefore") ?? ""}
                        onChange={(event) => filter(event.currentTarget.form!)}
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        name="includeUnknownDeadline"
                        value="true"
                        checked={
                          url.searchParams.get("includeUnknownDeadline") ===
                          "true"
                        }
                        onChange={(event) => filter(event.currentTarget.form!)}
                      />
                      Include unspecified deadlines
                    </label>
                    <p className="filter-hint">
                      Applies when a deadline filter is set.
                    </p>
                  </div>
                </details>
              </form>
            </aside>
            <section aria-label="Opportunity results">
              <div className="results-heading">
                <h2>
                  {items ? `${items.total} opportunities` : "Opportunities"}
                </h2>
                <span>Newest first</span>
              </div>
              {error && (
                <ErrorState error={error} reset={() => navigate("/")} />
              )}
              {items && items.items.length === 0 && (
                <div className="state">
                  <h3>No opportunities match these filters.</h3>
                  <p>Try another topic or a wider date range.</p>
                  <button className="text-button" onClick={() => navigate("/")}>
                    Clear filters
                  </button>
                </div>
              )}
              <div className="cards">
                {items?.items.map((o) => (
                  <article className="card" key={o.id}>
                    <div className="card-top">
                      <span
                        className={`type-tag type-${o.jobType.replaceAll(" ", "-").toLowerCase()}`}
                      >
                        {o.jobType}
                      </span>
                      <span className="posted">
                        Announced {date(o.publishedAt)}
                      </span>
                    </div>
                    <h3>
                      <Link href={`/opportunities/${o.id}`} navigate={navigate}>
                        {o.title}
                      </Link>
                    </h3>
                    <p className="organization">
                      {o.organization ?? "Organization not specified"}
                    </p>
                    <p className="place">
                      {[
                        [o.city, o.country].filter(Boolean).join(", "),
                        o.duration,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Location not specified"}
                    </p>
                    <div className="tags">
                      {o.topics.slice(0, 3).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                      {o.topics.length > 3 && (
                        <span>+{o.topics.length - 3}</span>
                      )}
                    </div>
                    <div className="card-bottom">
                      <span>
                        Deadline <strong>{date(o.applicationDeadline)}</strong>
                        {deadlinePassed(o.applicationDeadline) && (
                          <small className="expired">Deadline passed</small>
                        )}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
              {items && items.total > items.limit && (
                <nav className="pagination" aria-label="Results pages">
                  <button
                    disabled={items.page <= 1}
                    onClick={() => pager(items.page - 1)}
                  >
                    ← Previous
                  </button>
                  <span>
                    Page {items.page} of{" "}
                    {Math.max(1, Math.ceil(items.total / items.limit))}
                  </span>
                  <button
                    disabled={items.page * items.limit >= items.total}
                    onClick={() => pager(items.page + 1)}
                  >
                    Next →
                  </button>
                </nav>
              )}
            </section>
          </div>
        )}
        {(id || unknownPath) && error && (
          <ErrorState error={error} reset={() => navigate("/")} />
        )}
        {item && (
          <article className="detail">
            <div className="detail-heading">
              <span className="type-tag">{item.jobType}</span>
              <h1>{item.title}</h1>
              {deadlinePassed(item.applicationDeadline) && (
                <p className="deadline-notice">
                  The announced deadline has passed. This listing is kept for
                  reference; check with the institution for availability.
                </p>
              )}
              {!item.applicationDeadline && (
                <p className="muted">
                  No firm deadline was specified. Availability has not been
                  verified.
                </p>
              )}
              <p className="detail-org">
                {item.organization ?? "Organization not specified"}
              </p>
              <div className="tags">
                {item.topics.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
            <div className="detail-grid">
              <div>
                <h2>About the opportunity</h2>
                <p className="description">{item.description}</p>
                <PositionDocuments attachments={item.attachments} />
                <Announcements key={item.id} references={item.announcements} />
                <h2>Vacancy information</h2>
                <p className="muted">
                  {item.applicationUrl
                    ? "Check the original vacancy for current availability and application requirements."
                    : item.contact
                      ? "Contact the recruiting team for current availability and application requirements."
                      : "Application details are not available. Contact the institution for further information."}
                </p>
                {item.sources
                  .filter(
                    (s, i, all) =>
                      s.url &&
                      all.findIndex((other) => other.url === s.url) === i,
                  )
                  .map((s, i) => (
                    <div className="source" key={i}>
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {s.label.startsWith("AFXR")
                            ? "AFXR announcement ↗"
                            : "Original vacancy ↗"}
                        </a>
                      ) : (
                        <span>{s.label}</span>
                      )}
                    </div>
                  ))}
                <p className="muted">
                  Published {date(item.publishedAt)} · Updated{" "}
                  {date(item.updatedAt)}
                </p>
              </div>
              <aside className="facts">
                <h2>At a glance</h2>
                <dl>
                  {[
                    ["Laboratory", item.laboratory],
                    ["Country", item.country],
                    ["City", item.city],
                    ["Duration", item.duration],
                    ["Compensation", item.compensation],
                    ["Start date", date(item.startDate)],
                    ["Application deadline", date(item.applicationDeadline)],
                    ["Recruitment contact", item.contact],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value ?? "Not specified"}</dd>
                    </div>
                  ))}
                </dl>
                {item.applicationUrl && (
                  <a
                    className="button"
                    href={item.applicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View vacancy & apply ↗
                  </a>
                )}
              </aside>
            </div>
          </article>
        )}
      </main>
      <footer className="shell footer">
        <span>Updated {date(updatedAt)}</span>
        <a
          href="https://github.com/EPeillard/academic-opportunities"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source code
        </a>
      </footer>
    </>
  );
}
function ErrorState({ error, reset }: { error: string; reset: () => void }) {
  return (
    <div className="state" role="alert">
      <h3>{error}</h3>
      <button className="text-button" onClick={reset}>
        Reset & return to opportunities
      </button>
    </div>
  );
}
