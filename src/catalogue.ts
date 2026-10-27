import { JOB_TYPES, TOPICS, QuerySchema } from "./schema";
import raw from "../data/opportunities.json";

// The catalogue is part of the build. Browsing never calls a database or API.
import type { Opportunity } from "./schema";

// The complete JSON is validated by the build before publication.
export const opportunities = raw as Opportunity[];
export const updatedAt = opportunities.reduce(
  (last, item) => (item.updatedAt > last ? item.updatedAt : last),
  "",
);
export const todayUTC = () => new Date().toISOString().slice(0, 10);
export function deadlinePassed(deadline: string | null, today = todayUTC()) {
  return deadline !== null && deadline < today;
}
export function getFacets() {
  return {
    countries: [
      ...new Set(opportunities.flatMap((o) => (o.country ? [o.country] : []))),
    ].sort(),
    topics: [...TOPICS],
    types: [...JOB_TYPES],
  };
}
export function listOpportunities(params: URLSearchParams, today = todayUTC()) {
  if ([...params.keys()].some((key) => params.getAll(key).length > 1))
    throw new Error(
      "The filters in this URL are invalid. Reset them to continue.",
    );
  const parsed = QuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success)
    throw new Error(
      "The filters in this URL are invalid. Reset them to continue.",
    );
  const q = parsed.data;
  const term = q.q.toLocaleLowerCase();
  const items = opportunities
    .filter(
      (o) =>
        (!term ||
          [o.title, o.organization, o.laboratory, o.description]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(term)) &&
        (!q.type || o.jobType === q.type) &&
        (!q.topic || o.topics.includes(q.topic)) &&
        (!q.country || o.country === q.country) &&
        (!q.publishedSince || o.publishedAt.slice(0, 10) >= q.publishedSince) &&
        (!q.deadlineBefore ||
          (o.applicationDeadline
            ? o.applicationDeadline <= q.deadlineBefore
            : q.includeUnknownDeadline === "true")) &&
        (q.deadlineStatus === "all" ||
          (q.deadlineStatus === "past"
            ? deadlinePassed(o.applicationDeadline, today)
            : o.applicationDeadline !== null &&
              !deadlinePassed(o.applicationDeadline, today))),
    )
    .sort(
      (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id),
    );
  return {
    items: items.slice((q.page - 1) * q.limit, q.page * q.limit),
    total: items.length,
    page: q.page,
    limit: q.limit,
  };
}
export function getOpportunity(id: string) {
  const item = opportunities.find((o) => o.id === id);
  if (!item) throw new Error("This opportunity could not be found.");
  return item;
}
