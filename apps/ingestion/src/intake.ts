import { inspectHeaders, readBounded, sha256 } from "./mime";
import { admit, register } from "./storage";
import { dispatchOutbox } from "./processing";
import {
  event,
  IntakeError,
  iso,
  limits,
  objectKey,
  type IngestionEnv,
  type Receipt,
} from "./types";
async function ingest(
  message: Pick<ForwardableEmailMessage, "raw" | "rawSize" | "setReject">,
  env: IngestionEnv,
  now = Date.now(),
) {
  try {
    if (env.INGESTION_ENABLED !== "true") throw new IntakeError("DISABLED");
    const policy = limits(env);
    if (!Number.isSafeInteger(message.rawSize) || message.rawSize <= 0)
      throw new IntakeError("INVALID_MESSAGE");
    if (message.rawSize > policy.bytes)
      throw new IntakeError("MESSAGE_TOO_LARGE");
    const bytes = await readBounded(message.raw, policy.bytes);
    if (bytes.byteLength !== message.rawSize)
      throw new IntakeError("INVALID_MESSAGE");
    const metadata = await inspectHeaders(bytes);
    const hash = await sha256(bytes);
    await admit(env, hash, now);
    const receipt: Receipt = {
      hash,
      key: objectKey(hash),
      size: bytes.length,
      receivedAt: iso(now),
      ...metadata,
    };
    // Immutable content address; retries cannot refresh original retention or overwrite metadata.
    const stored = await env.RAW_EMAILS.put(receipt.key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: hash,
      httpMetadata: {
        contentType: "application/octet-stream",
        contentDisposition: "attachment",
      },
      customMetadata: { version: "1", receivedAt: receipt.receivedAt },
    });
    if (!stored) {
      const existing = await env.RAW_EMAILS.head(receipt.key);
      if (!existing || existing.size !== receipt.size)
        throw new Error("R2_NOT_DURABLE");
      receipt.receivedAt =
        existing.customMetadata?.receivedAt ?? iso(existing.uploaded.getTime());
    }
    await register(env, receipt);
    event("RECEIPT_DURABLE");
  } catch (error) {
    // A racing deletion may leave a raw orphan but can never create an active job.
    // Inventory reconciliation purges it; never delete here across another delivery's write.
    const code =
      error instanceof IntakeError ? error.code : "STORAGE_UNAVAILABLE";
    event(code);
    message.setReject(
      code === "MESSAGE_TOO_LARGE"
        ? "Message exceeds intake size limit."
        : code === "INVALID_MESSAGE"
          ? "Invalid email message."
          : "Email intake unavailable or message not accepted.",
    );
    return;
  }
  // Best-effort immediate dispatch AFTER the acceptance boundary; cron owns recovery.
  if (env.PROCESSING_ENABLED === "true") {
    try {
      await dispatchOutbox(env, now, 1);
    } catch {
      event("OUTBOX_DEFERRED");
    }
  }
}

// Isolate-local memory budget: includes chunks, concatenation and digest copies.
// Combined with sequential Queue processing this leaves headroom under 128 MiB.
let reservedBytes = 0;
export async function receive(
  message: Pick<ForwardableEmailMessage, "raw" | "rawSize" | "setReject">,
  env: IngestionEnv,
  now = Date.now(),
) {
  let reservation = 0;
  try {
    reservation = limits(env).bytes * 3;
    if (reservedBytes + reservation > 48 * 1024 * 1024) {
      event("INTAKE_BUSY");
      message.setReject("Email intake capacity unavailable.");
      return;
    }
  } catch {
    event("INVALID_CONFIGURATION");
    message.setReject("Email intake unavailable.");
    return;
  }
  reservedBytes += reservation;
  try {
    await ingest(message, env, now);
  } finally {
    reservedBytes -= reservation;
  }
}
