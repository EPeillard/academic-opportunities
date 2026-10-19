import { z } from "zod";

export const JOB_TYPES = [
  "Internship",
  "PhD",
  "Postdoc",
  "Research Engineer",
  "Research Scientist",
  "Faculty",
  "Other",
] as const;
export const TOPICS = [
  "Human–Computer Interaction",
  "Extended Reality",
  "Graphics & Visualization",
  "Robotics & HRI",
  "AI & Machine Learning",
  "Computer Vision",
  "Perception & Cognitive Science",
  "Software Engineering",
  "Cybersecurity",
  "Data Science",
  "Human Factors",
  "Interdisciplinary",
] as const;
export const PublicationStateSchema = z.enum([
  "draft",
  "pending_review",
  "published",
  "rejected",
  "archived",
]);
export const JobTypeSchema = z.enum(JOB_TYPES);
export const TopicSchema = z.enum(TOPICS);
export const DateSchema = z.iso.date();
export const PublicUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.port &&
        !/[\[\]:]/.test(u.hostname) &&
        !/^\d+(\.\d+)*$/.test(u.hostname) &&
        /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) &&
        !/(^|\.)(localhost|local|internal|test|invalid)$/i.test(u.hostname)
      );
    } catch {
      return false;
    }
  }, "Expected a public HTTPS URL without credentials or a custom port");
const text = z.string().trim().min(1).max(500);
export const ExtractedFieldsSchema = z
  .object({
    title: text.nullable(),
    jobType: JobTypeSchema.nullable(),
    organization: text.nullable(),
    laboratory: text.nullable(),
    country: text.nullable(),
    city: text.nullable(),
    topics: z.array(TopicSchema).max(TOPICS.length),
    duration: text.nullable(),
    compensation: text.nullable(),
    startDate: DateSchema.nullable(),
    applicationDeadline: DateSchema.nullable(),
    contact: text.nullable(),
    applicationUrl: PublicUrlSchema.nullable(),
    description: z.string().min(1).max(30000).nullable(),
  })
  .strict();
export const EvidenceSchema = z
  .object({
    field: z.enum(ExtractedFieldsSchema.keyof().options),
    messageId: text,
    quote: z.string().min(1).max(4000),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((v) => v.end > v.start, "Evidence span must be ordered");
export const ExtractionSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: text,
    model: text,
    candidates: z
      .array(
        z
          .object({
            fields: ExtractedFieldsSchema,
            evidence: z.array(EvidenceSchema),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export interface ExtractionProvider {
  extract(
    input: { messageId: string; untrustedText: string; schemaVersion: 1 },
    signal: AbortSignal,
  ): Promise<z.infer<typeof ExtractionSchema>>;
}
// Full-text permission is deliberately separate from extraction confidence.
export const PermissionCheckSchema = z
  .object({
    decision: z.enum([
      "summary_only",
      "authorized_full_text",
      "unknown",
      "denied",
    ]),
    policyId: text.nullable(),
    checkedAt: z.iso.datetime(),
    reason: text,
  })
  .strict()
  .refine(
    (v) => v.decision !== "authorized_full_text" || v.policyId !== null,
    "Full text needs an independently recorded policy",
  );
export const PublicSourceSchema = z
  .object({
    label: text,
    url: PublicUrlSchema.nullable(),
    receivedAt: z.iso.datetime(),
  })
  .strict();
export const OpportunitySchema = ExtractedFieldsSchema.extend({
  id: z.string().regex(/^[a-z0-9-]{1,100}$/),
  title: text,
  jobType: JobTypeSchema,
  description: z.string().min(1).max(30000),
  state: z.literal("published"),
  publicationFormat: z.enum(["summary", "authorized_full_text"]),
  publishedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  sources: z.array(PublicSourceSchema),
  synthetic: z.boolean(),
}).strict();
export type Opportunity = z.infer<typeof OpportunitySchema>;
export const QuerySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    type: JobTypeSchema.optional(),
    topic: TopicSchema.optional(),
    country: z.string().trim().min(1).max(100).optional(),
    publishedSince: DateSchema.optional(),
    deadlineBefore: DateSchema.optional(),
    includeUnknownDeadline: z.enum(["true", "false"]).default("false"),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
  })
  .strict();
export const ListSchema = z
  .object({
    items: z.array(OpportunitySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  })
  .strict();
export const FacetsSchema = z
  .object({
    countries: z.array(z.string()),
    topics: z.array(TopicSchema),
    types: z.array(JobTypeSchema),
  })
  .strict();

// Private pipeline contracts. They are never included in public response schemas.
export const IngestionJobPayloadSchema = z
  .object({
    jobId: z.string().regex(/^integrity-v1-[a-f0-9]{64}$/),
  })
  .strict();
export const IntegrityOutcomeSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("mime_integrity_verified"),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
