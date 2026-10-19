import { z } from "zod";
import {
  EvidenceSchema,
  ExtractedFieldsSchema,
} from "../../../packages/shared/src";
export const MessageIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const BatchQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(3).default(3),
    cursor: MessageIdSchema.optional(),
  })
  .strict();
export const CandidateSchema = z
  .object({
    fields: ExtractedFieldsSchema.extend({
      description: z.string().min(1).max(4000).nullable(),
    }).strict(),
    evidence: z
      .array(
        EvidenceSchema.safeExtend({
          messageId: MessageIdSchema,
          quote: z.string().min(1).max(2000),
        }).strict(),
      )
      .max(30),
  })
  .strict();
export const MessageResultSchema = z
  .object({
    messageId: MessageIdSchema,
    candidates: z.array(CandidateSchema).max(3),
  })
  .strict();
export const SubmissionSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.uuid(),
    submissionId: z.uuid(),
    results: z.array(MessageResultSchema).min(1).max(3),
  })
  .strict();
export const BatchResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.uuid().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    nextCursor: MessageIdSchema.nullable(),
    messages: z
      .array(
        z
          .object({
            messageId: MessageIdSchema,
            synthetic: z.literal(true),
            contentType: z.literal("text/plain"),
            textSha256: MessageIdSchema,
            untrustedText: z.string().max(6000),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export const ReceiptSchema = z
  .object({
    submissionId: z.uuid(),
    batchId: z.uuid(),
    receivedAt: z.iso.datetime(),
    messageCount: z.number().int().min(1).max(3),
    state: z.literal("pending_validation"),
  })
  .strict();
export type Submission = z.infer<typeof SubmissionSchema>;
