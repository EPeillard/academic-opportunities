// Local workerd end-to-end rehearsal; no Cloudflare account or remote API used.
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery as statements } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
const fixtureDir = new URL("../tests/fixtures/mime/", import.meta.url);
const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(
    new URL("../apps/ingestion/dist/index.js", import.meta.url),
  ),
  compatibilityDate: "2026-06-11",
  unsafeTriggerHandlers: true, // Miniflare's local-only email/scheduled simulation routes.
  bindings: {
    APP_ENV: "local",
    INGESTION_ENABLED: "true",
    PROCESSING_ENABLED: "true",
  },
  d1Databases: { DB: "m2-smoke-db" },
  r2Buckets: { RAW_EMAILS: "m2-smoke-private" },
  queueProducers: { INGESTION_QUEUE: "m2-smoke-queue" },
  queueConsumers: {
    "m2-smoke-queue": { maxBatchSize: 5, maxBatchTimeout: 0, maxRetries: 3 },
  },
  // A regression that fetches a URL from an email must fail locally, never reach the Internet.
  outboundService: () => {
    throw new Error("Unexpected outbound HTTP from ingestion Worker");
  },
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const db = await mf.getD1Database("DB");
  for (const name of readdirSync(
    new URL("../apps/worker/migrations/", import.meta.url),
  )
    .filter((x) => x.endsWith(".sql"))
    .sort())
    for (const stmt of statements(
      readFileSync(
        new URL(`../apps/worker/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    ))
      await db.prepare(stmt).run();
  for (const name of [
    "plain.eml",
    "html.eml",
    "multipart.eml",
    "attachment.eml",
    "gmail-forward.eml",
    "plain.eml",
  ]) {
    const bytes = readFileSync(new URL(name, fixtureDir));
    const from =
      name === "gmail-forward.eml"
        ? "forwarder@example.org"
        : "research@example.org";
    const response = await mf.dispatchFetch(
      `http://localhost/cdn-cgi/handler/email?from=${from}&to=intake@example.org`,
      { method: "POST", body: bytes },
    );
    assert.equal(
      response.status,
      200,
      `Local email simulation failed: ${await response.text()}`,
    );
  }
  let succeeded = 0;
  for (let n = 0; n < 100; n++) {
    succeeded = (
      await db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='succeeded'")
        .first()
    ).n;
    if (succeeded === 5) break;
    await pause(100);
  }
  assert.equal(
    succeeded,
    5,
    "Queue consumer did not complete five durable integrity jobs",
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM messages").first()).n,
    5,
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM opportunities").first()).n,
    0,
  );
  const bucket = await mf.getR2Bucket("RAW_EMAILS");
  assert.equal((await bucket.list()).objects.length, 5);
  for (const name of [
    "plain.eml",
    "html.eml",
    "multipart.eml",
    "attachment.eml",
    "gmail-forward.eml",
  ]) {
    const bytes = readFileSync(new URL(name, fixtureDir));
    assert.deepEqual(
      Buffer.from(
        await (await bucket.get(`mime/v1/${hash(bytes)}.eml`)).arrayBuffer(),
      ),
      bytes,
    );
  }
  const worker = await mf.getWorker();
  const identifier = `integrity-v1-${hash(readFileSync(new URL("plain.eml", fixtureDir)))}`;
  const delivery = await worker.queue("m2-smoke-queue", [
    {
      id: "duplicate-ack",
      timestamp: new Date(),
      attempts: 1,
      body: { jobId: identifier },
    },
  ]);
  assert.ok(delivery.explicitAcks.includes("duplicate-ack"));
  assert.equal(
    (
      await db
        .prepare("SELECT attempt_count FROM jobs WHERE id=?")
        .bind(identifier)
        .first()
    ).attempt_count,
    1,
  );
  // Each scheduled tick runs one bounded maintenance phase.
  for (let n = 0; n < 5; n++)
    assert.equal((await worker.scheduled()).outcome, "ok");
  for (const path of ["/", "/api/raw-mails", "/admin", "/debug"]) {
    const response = await worker.fetch(`http://private.example${path}`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      await response.text(),
      /research@|Synthetic PhD|mime\/v1/,
    );
  }
  console.log(
    "Local M2 end-to-end passed: real email handler, immutable private R2, D1 transactions, actual simulated Queue consumer, duplicate acknowledgment, scheduled phases and no outbound HTTP/public MIME.",
  );
} finally {
  await mf.dispose();
}
