import { z } from "zod";
import {
  JOB_TYPES,
  TOPICS,
  OpportunitySchema,
  QuerySchema,
} from "@academic/shared";
import raw from "../../../data/opportunities.json";

// The catalogue is part of the build. Browsing never calls a database or API.
export const opportunities = z.array(OpportunitySchema).parse(raw);
export const updatedAt = opportunities.reduce(
  (last, item) => (item.updatedAt > last ? item.updatedAt : last),
  "",
);
export const todayUTC = () => new Date().toISOString().slice(0, 10);
export function deadlinePassed(deadline: string | null, today = todayUTC()) {
  return deadline !== null && deadline < today;
}
export function readCatalogue(path: string, today = todayUTC()) {
  const url = new URL(path, "https://catalogue.local");
  if (url.pathname === "/api/facets")
    return {
      countries: [
        ...new Set(
          opportunities.flatMap((o) => (o.country ? [o.country] : [])),
        ),
      ].sort(),
      topics: [...TOPICS],
      types: [...JOB_TYPES],
    };
  if (url.pathname === "/api/opportunities") {
    if (
      [...url.searchParams.keys()].some(
        (key) => url.searchParams.getAll(key).length > 1,
      )
    )
      throw new Error(
        "The filters in this URL are invalid. Reset them to continue.",
      );
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
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
          (!q.publishedSince ||
            o.publishedAt.slice(0, 10) >= q.publishedSince) &&
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
          b.publishedAt.localeCompare(a.publishedAt) ||
          a.id.localeCompare(b.id),
      );
    return {
      items: items.slice((q.page - 1) * q.limit, q.page * q.limit),
      total: items.length,
      page: q.page,
      limit: q.limit,
    };
  }
  const id = url.pathname.match(
    /^\/api\/opportunities\/([a-z0-9-]{1,100})$/,
  )?.[1];
  const item = opportunities.find((o) => o.id === id);
  if (!item) throw new Error("This opportunity could not be found.");
  return item;
}
