import React, { useEffect, useState } from "react";
import {
  FacetsSchema,
  JOB_TYPES,
  ListSchema,
  OpportunitySchema,
  TOPICS,
} from "@academic/shared";
import type { Opportunity } from "@academic/shared";
import "./styles.css";

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Not specified";
const currentLocation = () => window.location.pathname + window.location.search;
function useLocation() {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate = (path: string) => {
    window.history.pushState(null, "", path);
    setLocation(currentLocation());
    window.scrollTo({ top: 0 });
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
async function request(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "This opportunity could not be found."
        : response.status === 400
          ? "The filters in this URL are invalid. Reset them to continue."
          : "We could not load opportunities. Please try again.",
    );
  return response.json();
}
export function App() {
  const [location, navigate] = useLocation();
  const [data, setData] = useState<
    ReturnType<typeof ListSchema.parse> | Opportunity | null
  >(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const url = new URL(location, window.location.origin),
    match = url.pathname.match(/^\/opportunities\/([a-z0-9-]+)$/),
    id = match?.[1];
  const unknownPath = url.pathname !== "/" && !match;
  useEffect(() => {
    const c = new AbortController();
    request("/api/facets", c.signal)
      .then((raw) => setCountries(FacetsSchema.parse(raw).countries))
      .catch(() => {});
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    if (unknownPath) {
      setError("This page could not be found.");
      setLoading(false);
      return () => c.abort();
    }
    request(
      id ? `/api/opportunities/${id}` : `/api/opportunities${url.search}`,
      c.signal,
    )
      .then((raw) =>
        setData(id ? OpportunitySchema.parse(raw) : ListSchema.parse(raw)),
      )
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load opportunities.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [location, retry]);
  const items = data && "items" in data ? data : null;
  const item = data && "title" in data ? data : null;
  function filter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget))
      if (String(value).trim()) params.set(key, String(value).trim());
    navigate(`/?${params}`);
  }
  const pager = (page: number) => {
    const p = new URLSearchParams(url.search);
    p.set("page", String(page));
    navigate(`/?${p}`);
  };
  return (
    <>
      <div className="demo">
        LOCAL DEMO{" "}
        <span>
          All opportunities and organizations shown here are fictional.
        </span>
      </div>
      <header className="masthead">
        <div className="shell nav">
          <Link href="/" navigate={navigate} className="brand">
            <span className="brand-icon" aria-hidden="true">
              a<span>o</span>
            </span>
            <span>
              Academic
              <br />
              Opportunities
            </span>
          </Link>
          <span className="nav-note">
            A new place to find your next question.
          </span>
          <a
            className="github"
            href="https://github.com/EPeillard/academic-opportunities"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open source ↗
          </a>
        </div>
      </header>
      <main id="main" className="shell">
        {!id && !unknownPath && (
          <section className="hero">
            <p className="eyebrow">RESEARCH STARTS WITH A POSSIBILITY</p>
            <h1>
              Your next chapter
              <br />
              in <em>research.</em>
            </h1>
            <div className="hero-bottom">
              <p>
                Discover opportunities across computer science
                <br className="desktop-break" /> and the disciplines it
                connects.
              </p>
              <div className="discipline-note">
                <span className="status-dot" /> One field. Many directions.
                <br />
                <small>From human factors to machine learning.</small>
              </div>
            </div>
          </section>
        )}
        {id && (
          <Link href="/" navigate={navigate} className="back">
            ← All opportunities
          </Link>
        )}
        {!id && !unknownPath && (
          <div className="content-grid">
            <aside>
              <form key={location} onSubmit={filter} className="filters">
                <div className="filter-heading">
                  <h2>Refine your search</h2>
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
                    defaultValue={url.searchParams.get("q") ?? ""}
                  />
                </label>
                <label>
                  Position type
                  <select
                    name="type"
                    defaultValue={url.searchParams.get("type") ?? ""}
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
                    defaultValue={url.searchParams.get("topic") ?? ""}
                  >
                    <option value="">All research areas</option>
                    {TOPICS.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Country
                  <select
                    name="country"
                    defaultValue={url.searchParams.get("country") ?? ""}
                  >
                    <option value="">Anywhere</option>
                    {countries.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Published on or after
                  <input
                    type="date"
                    name="publishedSince"
                    defaultValue={url.searchParams.get("publishedSince") ?? ""}
                  />
                </label>
                <label>
                  Deadline on or before
                  <input
                    type="date"
                    name="deadlineBefore"
                    defaultValue={url.searchParams.get("deadlineBefore") ?? ""}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="includeUnknownDeadline"
                    value="true"
                    defaultChecked={
                      url.searchParams.get("includeUnknownDeadline") === "true"
                    }
                  />
                  Include unspecified deadlines
                </label>
                <p className="filter-hint">
                  Applies when a deadline filter is set.
                </p>
                <button className="button" type="submit">
                  Find opportunities <span aria-hidden="true">→</span>
                </button>
              </form>
              <div className="aside-note">
                <span aria-hidden="true">↗</span>
                <p>
                  Science crosses boundaries.
                  <br />
                  Your next role can, too.
                </p>
              </div>
            </aside>
            <section aria-label="Opportunity results" aria-busy={loading}>
              <div className="results-heading">
                <h2>
                  {items ? `${items.total} opportunities` : "Opportunities"}
                </h2>
                <span>Newest first</span>
              </div>
              {loading && (
                <p className="state" role="status">
                  Loading opportunities…
                </p>
              )}
              {error && (
                <ErrorState
                  error={error}
                  retry={() => setRetry((v) => v + 1)}
                  reset={() => navigate("/")}
                />
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
                        Posted {date(o.publishedAt)}
                      </span>
                    </div>
                    <h3>
                      <Link href={`/opportunities/${o.id}`} navigate={navigate}>
                        {o.title}
                        <span className="card-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </Link>
                    </h3>
                    <p className="organization">
                      {o.organization ?? "Organization not specified"}
                    </p>
                    <p className="place">
                      {[o.city, o.country].filter(Boolean).join(", ") ||
                        "Location not specified"}{" "}
                      <span>·</span> {o.duration ?? "Duration not specified"}
                    </p>
                    <div className="tags">
                      {o.topics.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <div className="card-bottom">
                      <span>
                        Deadline <strong>{date(o.applicationDeadline)}</strong>
                      </span>
                      <Link href={`/opportunities/${o.id}`} navigate={navigate}>
                        View opportunity <span aria-hidden="true">→</span>
                      </Link>
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
        {id && loading && (
          <p className="state" role="status">
            Loading opportunity…
          </p>
        )}
        {(id || unknownPath) && error && (
          <ErrorState
            error={error}
            retry={() => setRetry((v) => v + 1)}
            reset={() => navigate("/")}
          />
        )}
        {item && (
          <article className="detail">
            <div className="detail-heading">
              <span className="type-tag">{item.jobType}</span>
              <p className="eyebrow">
                SYNTHETIC EXAMPLE ·{" "}
                {item.publicationFormat === "summary"
                  ? "FACTUAL SUMMARY"
                  : "AUTHORIZED FULL TEXT"}
              </p>
              <h1>{item.title}</h1>
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
                <h2>Sources & provenance</h2>
                <p className="muted">
                  This example is fictional. Source links use example.org and do
                  not lead to real vacancies.
                </p>
                {item.sources.map((s, i) => (
                  <div className="source" key={i}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.label} ↗
                      </a>
                    ) : (
                      <span>{s.label}</span>
                    )}
                    <small>Received {date(s.receivedAt)}</small>
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
                    Example application link ↗
                  </a>
                )}
              </aside>
            </div>
          </article>
        )}
      </main>
      <footer className="shell footer">
        <span>Academic Opportunities</span>
        <p>Connecting researchers with what comes next.</p>
        <span>Milestone 1 · Local demonstration</span>
      </footer>
    </>
  );
}
function ErrorState({
  error,
  retry,
  reset,
}: {
  error: string;
  retry: () => void;
  reset: () => void;
}) {
  return (
    <div className="state" role="alert">
      <h3>{error}</h3>
      <button className="text-button" onClick={retry}>
        Try again
      </button>{" "}
      <button className="text-button" onClick={reset}>
        Reset & return to opportunities
      </button>
    </div>
  );
}
