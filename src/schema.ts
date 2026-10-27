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
export const FieldsSchema = z
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
export const PublicSourceSchema = z
  .object({
    label: text,
    url: PublicUrlSchema.nullable(),
    receivedAt: z.iso.datetime(),
  })
  .strict();
export const OpportunitySchema = FieldsSchema.extend({
  id: z.string().regex(/^[a-z0-9-]{1,100}$/),
  title: text,
  jobType: JobTypeSchema,
  description: z.string().min(1).max(30000),
  publishedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  sources: z.array(PublicSourceSchema),
}).strict();
export type Opportunity = z.infer<typeof OpportunitySchema>;
export const QuerySchema = z
  .object({
    deadlineStatus: z.enum(["all", "upcoming", "past"]).default("all"),
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
