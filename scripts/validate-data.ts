import { z } from "zod";
import { OpportunitySchema } from "../packages/shared/src/index";
import records from "../data/opportunities.json";
const data = z.array(OpportunitySchema).min(1).parse(records);
const ids = new Set<string>();
for (const item of data) {
  if (ids.has(item.id)) throw new Error(`Duplicate ID: ${item.id}`);
  ids.add(item.id);
  if (item.synthetic || item.publicationFormat !== "summary")
    throw new Error(`Expected real factual summary: ${item.id}`);
  if (!item.sources.length) throw new Error(`Missing provenance: ${item.id}`);
  if (item.updatedAt < item.publishedAt)
    throw new Error(`Invalid chronology: ${item.id}`);
  if (
    /example\.(org|com)|unsubscribe|listserv\.acm|\ufffd/i.test(
      JSON.stringify(item),
    )
  )
    throw new Error(`Unexpected source residue: ${item.id}`);
}
console.log(`${data.length} opportunities validated; all IDs unique.`);
