import { z } from "zod";
import { OpportunitySchema, AnnouncementDocumentSchema } from "../src/schema";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import records from "../data/opportunities.json";
const data = z.array(OpportunitySchema).min(1).parse(records);
const ids = new Set<string>();
const announcements = new Set<string>();
const attachments = new Set<string>();
for (const item of data) {
  if (ids.has(item.id)) throw new Error(`Duplicate ID: ${item.id}`);
  ids.add(item.id);
  if (!item.sources.length) throw new Error(`Missing provenance: ${item.id}`);
  if (item.updatedAt < item.publishedAt)
    throw new Error(`Invalid chronology: ${item.id}`);
  const references = new Set<string>();
  for (const reference of item.announcements) {
    if (references.has(reference.id))
      throw new Error(`Duplicate announcement: ${item.id}`);
    references.add(reference.id);
    announcements.add(reference.id);
  }
  const documents = new Set<string>();
  for (const attachment of item.attachments) {
    if (documents.has(attachment.url))
      throw new Error(`Duplicate document: ${item.id}`);
    documents.add(attachment.url);
    attachments.add(attachment.url);
    const raw = readFileSync(
      new URL(`../public${attachment.url}`, import.meta.url),
    );
    if (raw.length !== attachment.size)
      throw new Error(`Incorrect file size: ${attachment.url}`);
    const extension = attachment.url.split(".").pop();
    const types: Record<string, string> = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      png: "image/png",
    };
    const expectedType = types[extension!];
    if (attachment.mediaType !== expectedType)
      throw new Error(`Incorrect file type: ${attachment.url}`);
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
    if (attachment.url !== `/documents/${hash}.${extension}`)
      throw new Error(`Incorrect content hash: ${attachment.url}`);
    if (extension === "pdf" && raw.subarray(0, 5).toString() !== "%PDF-")
      throw new Error(`Invalid PDF: ${attachment.url}`);
    if (extension === "docx" && raw.subarray(0, 2).toString() !== "PK")
      throw new Error(`Invalid DOCX: ${attachment.url}`);
    if (
      extension === "png" &&
      !raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error(`Invalid PNG: ${attachment.url}`);
  }
  if (
    /example\.(org|com)|unsubscribe|listserv\.acm|\ufffd/i.test(
      JSON.stringify(item),
    )
  )
    throw new Error(`Unexpected source residue: ${item.id}`);
}
for (const id of announcements) {
  const document = AnnouncementDocumentSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../data/announcements/${id}.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
  const text = document.parts.map((part) => part.text).join("");
  if (
    /\ufffd|[\uE000\uE001]|^\s*(?:From|To|Cc|Bcc|Subject|Sent|De|À|Objet|Envoyé)\s*:|unsubscribe|auto_signoff|listserv\.acm|etienne\.peillard/im.test(
      text,
    )
  ) {
    throw new Error(`Unexpected message residue: ${id}`);
  }
  if (
    document.parts.some(
      (part) =>
        part.href &&
        /unsubscribe|auto_signoff|listserv\.acm|etienne\.peillard/i.test(
          part.href,
        ),
    )
  )
    throw new Error(`Unexpected message link: ${id}`);
}
for (const file of readdirSync(
  new URL("../data/announcements/", import.meta.url),
)) {
  if (!announcements.has(file.replace(/\.json$/, "")))
    throw new Error(`Unreferenced announcement: ${file}`);
}
for (const file of readdirSync(
  new URL("../public/documents/", import.meta.url),
)) {
  if (!attachments.has(`/documents/${file}`))
    throw new Error(`Unreferenced position document: ${file}`);
}
console.log(
  `${data.length} opportunities, ${announcements.size} announcement texts and ${attachments.size} position documents validated; all IDs unique.`,
);
