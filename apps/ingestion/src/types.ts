export interface IngestionEnv {
  APP_ENV: "local" | "production";
  INGESTION_ENABLED?: string;
  PROCESSING_ENABLED?: string;
  MAX_MESSAGE_BYTES?: string;
  MAX_DAILY_MESSAGES?: string;
  RAW_RETENTION_DAYS?: string;
  DB: D1Database;
  RAW_EMAILS: R2Bucket;
  INGESTION_QUEUE: Queue<{ jobId: string }>;
}
export interface Receipt {
  hash: string;
  key: string;
  size: number;
  receivedAt: string;
  messageIdHash: string | null;
  messageIdKind: "valid" | "missing" | "malformed";
}
export interface Job {
  id: string;
  message_id: string;
  state: "queued" | "processing" | "succeeded" | "failed" | "dead";
  attempt_count: number;
  lease_token: string | null;
  lease_until: string | null;
  next_attempt_at: string | null;
}
export const PREFIX = "mime/v1/";
export const MAX_ATTEMPTS = 8;
export const LEASE_MS = 120_000;
export const WATCHDOG_MS = 900_000;
export const ORPHAN_GRACE_MS = 3_600_000;
export const PAGE_SIZE = 5;
export const hashPattern = /^[a-f0-9]{64}$/;
export const jobId = (hash: string) => `integrity-v1-${hash}`;
export const objectKey = (hash: string) => `${PREFIX}${hash}.eml`;
export const iso = (now: number) => new Date(now).toISOString();
export const backoff = (attempt: number) =>
  Math.min(3600, 30 * 2 ** Math.min(7, Math.max(0, attempt - 1)));
export const event = (code: string) =>
  console.log(JSON.stringify({ event: "ingestion", code }));
export class IntakeError extends Error {
  constructor(
    readonly code:
      | "INVALID_MESSAGE"
      | "MESSAGE_TOO_LARGE"
      | "DAILY_LIMIT"
      | "DELETED"
      | "DISABLED",
  ) {
    super(code);
  }
}
export function limits(env: IngestionEnv) {
  const integer = (
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error("INVALID_CONFIGURATION");
    return n;
  };
  if (env.APP_ENV !== "local" && env.APP_ENV !== "production")
    throw new Error("INVALID_ENVIRONMENT");
  return {
    bytes: integer(
      env.MAX_MESSAGE_BYTES,
      2 * 1024 * 1024,
      1024,
      10 * 1024 * 1024,
    ),
    daily: integer(env.MAX_DAILY_MESSAGES, 500, 1, 10000),
    retentionDays: integer(env.RAW_RETENTION_DAYS, 30, 1, 90),
  };
}
