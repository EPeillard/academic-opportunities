import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { unstable_splitSqlQuery as statements } from "wrangler";
import { receive } from "../apps/ingestion/src/intake";
import {
  inspectHeaders,
  readBounded,
  sha256,
} from "../apps/ingestion/src/mime";
import { admit, deleteMessage, register } from "../apps/ingestion/src/storage";
import {
  consume,
  dispatchOutbox,
  integrityStep,
  processJob,
} from "../apps/ingestion/src/processing";
import { reconcile, maintenanceTick } from "../apps/ingestion/src/maintenance";
import {
  iso,
  jobId,
  LEASE_MS,
  objectKey,
  ORPHAN_GRACE_MS,
  WATCHDOG_MS,
  type IngestionEnv,
} from "../apps/ingestion/src/types";
import { handleRequest } from "../apps/worker/src";
let mf: Miniflare, env: IngestionEnv;
const send = vi.fn();
const now = Date.now();
const fixture = (name = "plain.eml") =>
  new Uint8Array(
    readFileSync(new URL(`./fixtures/mime/${name}`, import.meta.url)),
  );
const raw = (bytes: Uint8Array, reported = bytes.length) => ({
  rawSize: reported,
  raw: new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  }),
  setReject: vi.fn(),
});
const query = async (sql: string, ...values: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...values)
    .first<any>();
const accept = async (name = "plain.eml", at = now, target = env) => {
  const mail = raw(fixture(name));
  await receive(mail as any, target, at);
  return mail;
};
const id = async (name = "plain.eml") => jobId(await sha256(fixture(name)));
const job = async (name = "plain.eml") =>
  query("SELECT * FROM jobs WHERE id=?", await id(name));
const failures = (binding: any, method: string) =>
  new Proxy(binding, {
    get(target, key) {
      if (key === method)
        return vi
          .fn()
          .mockRejectedValue(new Error("PRIVATE sender@example.org body"));
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("unused")}}',
    compatibilityDate: "2026-06-11",
    d1Databases: { DB: "m2-local" },
    r2Buckets: { RAW_EMAILS: "m2-private" },
  });
  env = {
    APP_ENV: "local",
    INGESTION_ENABLED: "true",
    PROCESSING_ENABLED: "false",
    DB: await mf.getD1Database("DB"),
    RAW_EMAILS: await mf.getR2Bucket("RAW_EMAILS"),
    INGESTION_QUEUE: { send },
  } as any;
  for (const name of readdirSync(
    new URL("../apps/worker/migrations", import.meta.url),
  )
    .filter((x) => x.endsWith(".sql"))
    .sort())
    for (const stmt of statements(
      readFileSync(
        new URL(`../apps/worker/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    ))
      await env.DB.prepare(stmt).run();
});
beforeEach(async () => {
  for (const table of [
    "outbox",
    "jobs",
    "messages",
    "deletion_tombstones",
    "intake_admissions",
    "ingestion_maintenance",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  const page = await env.RAW_EMAILS.list();
  for (const object of page.objects) await env.RAW_EMAILS.delete(object.key);
  send.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("bounded private email reception using local D1/R2", () => {
  it.each([
    "plain.eml",
    "html.eml",
    "multipart.eml",
    "attachment.eml",
    "gmail-forward.eml",
    "missing-id.eml",
    "malformed-id.eml",
  ])(
    "durably preserves exact bytes for %s without rendering MIME",
    async (name) => {
      expect((await accept(name)).setReject).not.toHaveBeenCalled();
      const hash = await sha256(fixture(name));
      expect(
        new Uint8Array(
          await (await env.RAW_EMAILS.get(objectKey(hash)))!.arrayBuffer(),
        ),
      ).toEqual(fixture(name));
      expect(await query("SELECT COUNT(*) AS n FROM outbox")).toMatchObject({
        n: 1,
      });
      expect(await job(name)).toMatchObject({
        state: "queued",
        attempt_count: 0,
        stage: "mime_integrity",
      });
      expect(
        await query("SELECT COUNT(*) AS n FROM opportunities"),
      ).toMatchObject({ n: 0 });
    },
  );
  it("records only hashed optional Message-ID and no envelope/subject", async () => {
    for (const name of ["plain.eml", "missing-id.eml", "malformed-id.eml"])
      await accept(name);
    const results = await env.DB.prepare(
      "SELECT * FROM messages ORDER BY message_id_kind",
    ).all<any>();
    expect(results.results.map((x) => x.message_id_kind)).toEqual([
      "malformed",
      "missing",
      "valid",
    ]);
    expect(results.results[2].message_id_hash).toHaveLength(64);
    expect(JSON.stringify(results.results)).not.toContain(
      "research@example.org",
    );
  });
  it("concurrent identical deliveries share one immutable object, job and outbox", async () => {
    const mails = await Promise.all(Array.from({ length: 6 }, () => accept()));
    expect(mails.every((m) => m.setReject.mock.calls.length === 0)).toBe(true);
    for (const table of ["messages", "jobs", "outbox"])
      expect(await query(`SELECT COUNT(*) AS n FROM ${table}`)).toMatchObject({
        n: 1,
      });
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(1);
  });
  it("same Message-ID with different content remains distinct, including Gmail wrapping", async () => {
    await accept();
    const bytes = new TextEncoder().encode(
      new TextDecoder().decode(fixture()).replace("robotics", "cybersecurity"),
    );
    const mail = raw(bytes);
    await receive(mail as any, env, now);
    await accept("gmail-forward.eml");
    expect(mail.setReject).not.toHaveBeenCalled();
    expect(await query("SELECT COUNT(*) AS n FROM messages")).toMatchObject({
      n: 3,
    });
    expect(
      await query("SELECT COUNT(DISTINCT message_id_hash) AS n FROM messages"),
    ).toMatchObject({ n: 2 });
  });
  it.each(["reported", "actual"])(
    "rejects %s oversized input before accepting/storing",
    async (kind) => {
      const bytes = new Uint8Array(2049).fill(65),
        mail = raw(bytes, kind === "reported" ? bytes.length : 100);
      await receive(mail as any, { ...env, MAX_MESSAGE_BYTES: "1024" }, now);
      expect(mail.setReject).toHaveBeenCalledWith(
        "Message exceeds intake size limit.",
      );
      expect((await env.RAW_EMAILS.list()).objects).toHaveLength(0);
    },
  );
  it.each([
    "",
    "not headers\r\n\r\nbody",
    "From: x\r\nBad Header\r\n\r\nbody",
    "From: x\0\r\n\r\nbody",
    " orphan continuation\r\n\r\nbody",
    `X-Large: ${"a".repeat(66000)}\r\n\r\nbody`,
  ])("rejects invalid or unbounded header structure", async (text) => {
    const mail = raw(new TextEncoder().encode(text));
    await receive(mail as any, env, now);
    expect(mail.setReject).toHaveBeenCalled();
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(0);
  });
  it("accepts folded and classifies repeated Message-ID without trusting it", async () => {
    expect(
      (
        await inspectHeaders(
          new TextEncoder().encode(
            "From: x\r\nMessage-ID:\r\n <folded@example.org>\r\n\r\nbody",
          ),
        )
      ).messageIdKind,
    ).toBe("valid");
    expect(
      (
        await inspectHeaders(
          new TextEncoder().encode(
            "From: x\nMessage-ID: <a@b>\nMessage-ID: <a@b>\n\nbody",
          ),
        )
      ).messageIdKind,
    ).toBe("malformed");
  });
  it("bounds tiny chunks, stalled reads, rawSize mismatch and stream exceptions", async () => {
    await expect(
      readBounded(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < 4097; i++) c.enqueue(new Uint8Array(0));
            c.close();
          },
        }),
        100,
      ),
    ).rejects.toThrow("INVALID_MESSAGE");
    await expect(readBounded(new ReadableStream(), 100, 5)).rejects.toThrow(
      "INVALID_MESSAGE",
    );
    const mismatch = raw(fixture(), 1);
    await receive(mismatch as any, env, now);
    expect(mismatch.setReject).toHaveBeenCalled();
    const broken = {
      rawSize: 100,
      raw: new ReadableStream({
        start(c) {
          c.error(new Error("private"));
        },
      }),
      setReject: vi.fn(),
    };
    await receive(broken as any, env, now);
    expect(broken.setReject).toHaveBeenCalled();
  });
  it("enforces an atomic daily unique-content cap while allowing exact replays", async () => {
    const capped = { ...env, MAX_DAILY_MESSAGES: "1" };
    const mails = await Promise.all([
      accept("plain.eml", now, capped),
      accept("html.eml", now, capped),
    ]);
    expect(
      mails.filter((m) => m.setReject.mock.calls.length === 0),
    ).toHaveLength(1);
    expect(
      await query("SELECT COUNT(*) AS n FROM intake_admissions"),
    ).toMatchObject({ n: 1 });
    const stored = await query("SELECT mime_sha256 FROM messages");
    const name =
      stored.mime_sha256 === (await sha256(fixture()))
        ? "plain.eml"
        : "html.eml";
    expect((await accept(name, now, capped)).setReject).not.toHaveBeenCalled();
  });
  it("fails closed when disabled or misconfigured, with no public ingestion surface", async () => {
    for (const vars of [
      { INGESTION_ENABLED: "false" },
      { MAX_MESSAGE_BYTES: "NaN" },
      { APP_ENV: "demo" },
    ]) {
      const mail = await accept("plain.eml", now, { ...env, ...vars } as any);
      expect(mail.setReject).toHaveBeenCalled();
    }
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(0);
  });
});

describe("durability boundaries and recovery", () => {
  it("rejects R2 failure and retries the existing D1 intent safely", async () => {
    const mail = await accept("plain.eml", now, {
      ...env,
      RAW_EMAILS: failures(env.RAW_EMAILS, "put"),
    });
    expect(mail.setReject).toHaveBeenCalled();
    expect(await job()).toBeNull();
    expect(
      await query("SELECT COUNT(*) AS n FROM intake_admissions"),
    ).toMatchObject({ n: 1 });
    expect((await accept()).setReject).not.toHaveBeenCalled();
  });
  it("D1 admission failure never writes R2", async () => {
    const mail = await accept("plain.eml", now, {
      ...env,
      DB: new Proxy(env.DB, {
        get(t, k) {
          if (k === "prepare")
            return () => {
              throw new Error("private");
            };
          const v = Reflect.get(t, k);
          return typeof v === "function" ? v.bind(t) : v;
        },
      }),
    });
    expect(mail.setReject).toHaveBeenCalled();
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(0);
  });
  it("D1 registration failure after R2 put is recovered by inventory, without email redelivery", async () => {
    const failed = { ...env, DB: failures(env.DB, "batch") };
    expect(
      (await accept("plain.eml", now, failed)).setReject,
    ).toHaveBeenCalled();
    expect(await job()).toBeNull();
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(1);
    await reconcile(
      { ...env, PROCESSING_ENABLED: "true" },
      now + ORPHAN_GRACE_MS + 60000,
    );
    expect(await job()).toMatchObject({ state: "queued" });
    expect(send).toHaveBeenCalledOnce();
  });
  it("D1 registration batch rolls back all statements when a later write fails", async () => {
    await env.DB.prepare(
      "CREATE TRIGGER fail_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    ).run();
    try {
      expect((await accept()).setReject).toHaveBeenCalled();
      expect(await query("SELECT COUNT(*) AS n FROM messages")).toMatchObject({
        n: 0,
      });
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_job").run();
    }
  });
  it("Queue failure after durable intake does not reject; outbox retries with backoff", async () => {
    send.mockRejectedValue(new Error("private"));
    expect(
      (await accept("plain.eml", now, { ...env, PROCESSING_ENABLED: "true" }))
        .setReject,
    ).not.toHaveBeenCalled();
    expect(await query("SELECT * FROM outbox")).toMatchObject({
      sent_at: null,
      attempts: 1,
      error_code: "QUEUE_UNAVAILABLE",
      next_attempt_at: iso(now + 30000),
    });
    send.mockResolvedValue(undefined);
    await dispatchOutbox(env, now + 1000);
    expect(send).toHaveBeenCalledOnce();
    await dispatchOutbox(env, now + 30000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual({ jobId: await id() });
  });
  it("crash after Queue publication before outbox commit safely republishes after dispatch lease expiry", async () => {
    await accept();
    let crash = true;
    const db = new Proxy(env.DB, {
      get(t, k) {
        if (k === "prepare")
          return (sql: string) => {
            if (crash && sql.startsWith("UPDATE outbox SET sent_at=")) {
              crash = false;
              throw new Error("crash");
            }
            return t.prepare(sql);
          };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await dispatchOutbox({ ...env, DB: db }, now);
    await dispatchOutbox(env, now + 30000);
    expect(send).toHaveBeenCalledTimes(2);
    await processJob(env, await id(), now + 30000);
    await processJob(env, await id(), now + 30000);
    expect((await job()).attempt_count).toBe(1);
  });
  it("true abrupt dispatch crash leaves a lease that can be reclaimed", async () => {
    await accept();
    await env.DB.prepare(
      "UPDATE outbox SET lease_token='crashed',lease_until=?",
    )
      .bind(iso(now + LEASE_MS))
      .run();
    await dispatchOutbox(env, now);
    expect(send).not.toHaveBeenCalled();
    await dispatchOutbox(env, now + LEASE_MS + 1);
    expect(send).toHaveBeenCalledOnce();
  });
  it("recovers Queue expiration and repairs a missing outbox", async () => {
    await accept();
    await dispatchOutbox(env, now);
    await reconcile(
      { ...env, PROCESSING_ENABLED: "true" },
      now + WATCHDOG_MS + 1,
    );
    expect(send).toHaveBeenCalledTimes(2);
    await env.DB.prepare("DELETE FROM outbox").run();
    await reconcile(
      { ...env, PROCESSING_ENABLED: "true" },
      now + WATCHDOG_MS + 2,
    );
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("repeated receipt after successful processing does not reset job or retention", async () => {
    await accept();
    await processJob(env, await id(), now);
    expect(
      (await accept("plain.eml", now + 86400000)).setReject,
    ).not.toHaveBeenCalled();
    expect(await job()).toMatchObject({ state: "succeeded", attempt_count: 1 });
    expect((await query("SELECT received_at FROM messages")).received_at).toBe(
      iso(now),
    );
  });
});

describe("consumer fencing, durable retries and privacy", () => {
  it("concurrent consumers execute the placeholder once and commit one outcome", async () => {
    await accept();
    const step = vi.fn(integrityStep);
    const theId = await id();
    await Promise.all(
      Array.from({ length: 5 }, () => processJob(env, theId, now, step)),
    );
    expect(step).toHaveBeenCalledOnce();
    expect(await job()).toMatchObject({ state: "succeeded", attempt_count: 1 });
  });
  it("replays after success-before-ack do not increment attempts", async () => {
    await accept();
    await processJob(env, await id(), now);
    expect(await processJob(env, await id(), now)).toBe("ack");
    const stored = await job();
    expect(stored.attempt_count).toBe(1);
    expect(JSON.parse(stored.outcome_json)).toMatchObject({
      kind: "mime_integrity_verified",
      version: 1,
    });
  });
  it("bounded processing retries become dead and are never automatically resurrected", async () => {
    await accept();
    let at = now;
    for (let attempt = 1; attempt <= 8; attempt++) {
      await processJob(env, await id(), at, async () => {
        throw new Error("private sender@example.org");
      });
      const stored = await job();
      expect(stored.attempt_count).toBe(attempt);
      at = Date.parse(stored.next_attempt_at);
    }
    expect(await job()).toMatchObject({
      state: "dead",
      error_code: "PROCESSING_UNAVAILABLE",
    });
    await reconcile({ ...env, PROCESSING_ENABLED: "true" }, at);
    expect(await processJob(env, await id(), at)).toBe("ack");
    expect((await job()).attempt_count).toBe(8);
  });
  it("does not run delayed work early", async () => {
    await accept();
    const step = vi.fn().mockRejectedValue(new Error("temporary"));
    await processJob(env, await id(), now, step);
    expect(await processJob(env, await id(), now + 1, step)).toBe("retry");
    expect(step).toHaveBeenCalledOnce();
  });
  it("expired lease recovery fences an old consumer finishing after a new attempt", async () => {
    await accept();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      begun = new Promise<void>((r) => (started = r));
    const old = processJob(env, await id(), now, async (e, h) => {
      started();
      await gate;
      return integrityStep(e, h);
    });
    await begun;
    await reconcile({ ...env, PROCESSING_ENABLED: "true" }, now + LEASE_MS + 1);
    await processJob(env, await id(), now + LEASE_MS + 30001);
    release();
    await old;
    expect(await job()).toMatchObject({
      state: "succeeded",
      attempt_count: 2,
      lease_token: null,
    });
  });
  it("last crashed attempt becomes terminal after lease expiry", async () => {
    await accept();
    await env.DB.prepare(
      "UPDATE jobs SET state='processing',attempt_count=8,lease_token='old',lease_until=?",
    )
      .bind(iso(now - 1))
      .run();
    await reconcile({ ...env, PROCESSING_ENABLED: "true" }, now);
    expect(await job()).toMatchObject({
      state: "dead",
      error_code: "LEASE_EXPIRED",
    });
  });
  it("detects missing objects with retries and corrupt bytes as terminal", async () => {
    await accept();
    const hash = await sha256(fixture());
    await env.RAW_EMAILS.delete(objectKey(hash));
    await processJob(env, await id(), now);
    expect(await job()).toMatchObject({
      state: "failed",
      error_code: "RAW_MISSING",
    });
    await env.RAW_EMAILS.put(objectKey(hash), new Uint8Array(fixture().length));
    await processJob(env, await id(), now + 30000);
    expect(await job()).toMatchObject({
      state: "dead",
      error_code: "INTEGRITY_MISMATCH",
    });
  });
  it("acks terminal/malformed deliveries and retries unavailable D1 or busy work", async () => {
    await accept();
    const messages = [
      { body: { jobId: await id() }, ack: vi.fn(), retry: vi.fn() },
      {
        body: { jobId: await id(), raw: "PRIVATE" },
        ack: vi.fn(),
        retry: vi.fn(),
      },
    ];
    await consume(
      { messages, retryAll: vi.fn() } as any,
      { ...env, PROCESSING_ENABLED: "true" },
      now,
    );
    expect(messages.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
    const broken = {
      body: { jobId: await id() },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await consume(
      { messages: [broken] } as any,
      { ...env, PROCESSING_ENABLED: "true", DB: failures(env.DB, "prepare") },
      now,
    );
    expect(broken.retry).toHaveBeenCalled();
    expect(broken.ack).not.toHaveBeenCalled();
    const retryAll = vi.fn();
    await consume({ retryAll } as any, env, now);
    expect(retryAll).toHaveBeenCalled();
  });
  it("does not log message bodies, addresses, headers or arbitrary backend exceptions", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await accept("plain.eml", now, {
        ...env,
        RAW_EMAILS: failures(env.RAW_EMAILS, "put"),
      });
      const text = JSON.stringify(log.mock.calls);
      expect(text).not.toMatch(
        /PRIVATE|sender@|research@|Message-ID|Synthetic PhD/,
      );
      expect(text).toContain("STORAGE_UNAVAILABLE");
    } finally {
      log.mockRestore();
    }
  });
  it("never exposes private ingestion metadata through public API", async () => {
    await accept();
    const publicEnv = {
      DB: env.DB,
      APP_ENV: "demo",
      ASSETS: { fetch: () => new Response("app") },
    } as any;
    for (const path of [
      "/api/messages",
      "/api/jobs",
      "/api/raw-mails",
      "/api/attachments",
    ])
      expect(
        (
          await handleRequest(
            new Request(`https://public.example${path}`),
            publicEnv,
          )
        ).status,
      ).toBe(404);
    const result = await handleRequest(
      new Request("https://public.example/api/opportunities"),
      publicEnv,
    );
    expect(await result.text()).not.toMatch(
      /mime_sha256|message_id_hash|raw|research@/,
    );
    expect(
      await query("SELECT COUNT(*) AS n FROM opportunities"),
    ).toMatchObject({ n: 0 });
  });
});

describe("retention, tombstones and inventory", () => {
  it("deletion wins during processing, duplicate delivery and orphan recovery", async () => {
    await accept();
    const hash = await sha256(fixture());
    await processJob(env, await id(), now, async (e, h) => {
      await deleteMessage(e, h, now);
      return {
        version: 1,
        kind: "mime_integrity_verified",
        sha256: h,
        sizeBytes: fixture().length,
      };
    });
    expect(await job()).toMatchObject({
      state: "dead",
      error_code: "DELETED",
      outcome_json: null,
    });
    expect((await accept()).setReject).toHaveBeenCalled();
    await env.RAW_EMAILS.put(objectKey(hash), fixture());
    await reconcile(
      { ...env, PROCESSING_ENABLED: "true" },
      now + ORPHAN_GRACE_MS + 1,
    );
    expect(await env.RAW_EMAILS.head(objectKey(hash))).toBeNull();
    expect(await job()).toMatchObject({ state: "dead" });
    expect(send).not.toHaveBeenCalled();
  });
  it("failed R2 deletion is repaired from permanent tombstone", async () => {
    await accept();
    const hash = await sha256(fixture());
    await expect(
      deleteMessage(
        { ...env, RAW_EMAILS: failures(env.RAW_EMAILS, "delete") },
        hash,
        now,
      ),
    ).rejects.toThrow();
    expect((await accept()).setReject).toHaveBeenCalled();
    await reconcile({ ...env, PROCESSING_ENABLED: "true" }, now);
    expect(await env.RAW_EMAILS.head(objectKey(hash))).toBeNull();
  });
  it("retention purges active/dead mail and old deleted rows do not starve later expirations", async () => {
    await accept();
    await deleteMessage(env, await sha256(fixture()), now);
    await accept("html.eml");
    await reconcile(
      { ...env, PROCESSING_ENABLED: "true" },
      now + 31 * 86400000,
    );
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(0);
    expect(
      await query("SELECT COUNT(*) AS n FROM messages WHERE status='deleted'"),
    ).toMatchObject({ n: 2 });
  });
  it("paginates R2 inventory and does not delete young or unrelated-prefix objects", async () => {
    const bytes = fixture();
    for (let i = 0; i < 24; i++)
      await env.RAW_EMAILS.put(
        objectKey(i.toString(16).padStart(64, "0")),
        bytes,
      );
    await env.RAW_EMAILS.put("other/keep", bytes);
    await reconcile({ ...env, PROCESSING_ENABLED: "true" }, now);
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(25);
    for (let i = 0; i < 6; i++)
      await reconcile(
        { ...env, PROCESSING_ENABLED: "true" },
        now + ORPHAN_GRACE_MS + 60000 + i,
      );
    expect((await env.RAW_EMAILS.list()).objects.map((o) => o.key)).toEqual([
      "other/keep",
    ]);
  });
});

describe("additional crash and operational boundaries", () => {
  it("bounds simultaneous intake buffering and releases its reservation", async () => {
    const bytes = fixture();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const first = {
      ...raw(bytes),
      raw: new ReadableStream<Uint8Array>({
        start(c) {
          streamController = c;
        },
      }),
    };
    const large = { ...env, MAX_MESSAGE_BYTES: String(10 * 1024 * 1024) };
    const pending = receive(first as any, large, now);
    const second = await accept("html.eml", now, large);
    expect(second.setReject).toHaveBeenCalledWith(
      "Email intake capacity unavailable.",
    );
    streamController.enqueue(bytes);
    streamController.close();
    await pending;
    expect(first.setReject).not.toHaveBeenCalled();
    expect(
      (await accept("html.eml", now, large)).setReject,
    ).not.toHaveBeenCalled();
  });
  it("a commit failure after the integrity read is durably retried without losing raw data", async () => {
    await accept();
    let once = true;
    const db = new Proxy(env.DB, {
      get(t, k) {
        if (k === "batch")
          return (...args: any[]) => {
            if (once) {
              once = false;
              throw new Error("commit failure");
            }
            return t.batch(...(args as [any]));
          };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await processJob({ ...env, DB: db }, await id(), now);
    expect(await job()).toMatchObject({
      state: "failed",
      attempt_count: 1,
      outcome_json: null,
    });
    expect(
      await env.RAW_EMAILS.head(objectKey(await sha256(fixture()))),
    ).not.toBeNull();
    await processJob(env, await id(), now + 30000);
    expect(await job()).toMatchObject({ state: "succeeded", attempt_count: 2 });
  });
  it("a stale failing worker cannot overwrite a newer successful attempt", async () => {
    await accept();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      begun = new Promise<void>((r) => (started = r));
    const pending = processJob(env, await id(), now, async () => {
      started();
      await gate;
      throw new Error("stale private error");
    });
    await begun;
    await reconcile({ ...env, PROCESSING_ENABLED: "true" }, now + LEASE_MS + 1);
    await processJob(env, await id(), now + LEASE_MS + 30001);
    release();
    await pending;
    expect(await job()).toMatchObject({
      state: "succeeded",
      attempt_count: 2,
      error_code: null,
    });
  });
  it("keeps the scheduled phase checkpoint on failure and advances only after successful retry", async () => {
    const active = { ...env, PROCESSING_ENABLED: "true" };
    await maintenanceTick(active, now);
    expect(
      await query("SELECT value FROM ingestion_maintenance WHERE name='phase'"),
    ).toMatchObject({ value: "1" });
    await expect(
      maintenanceTick({ ...active, DB: failures(env.DB, "prepare") }, now),
    ).rejects.toThrow();
    expect(
      await query("SELECT value FROM ingestion_maintenance WHERE name='phase'"),
    ).toMatchObject({ value: "1" });
    await maintenanceTick(active, now);
    expect(
      await query("SELECT value FROM ingestion_maintenance WHERE name='phase'"),
    ).toMatchObject({ value: "2" });
  });
  it("an admission-only crash does not create accepted work or a fake MIME object", async () => {
    await admit(env, await sha256(fixture()), now);
    await reconcile(
      { ...env, PROCESSING_ENABLED: "true" },
      now + ORPHAN_GRACE_MS + 60000,
    );
    expect(await job()).toBeNull();
    expect((await env.RAW_EMAILS.list()).objects).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect((await accept()).setReject).not.toHaveBeenCalled();
  });
  it("the database enforces the one-outbox-per-job invariant", async () => {
    await accept();
    await expect(
      env.DB.prepare(
        "INSERT INTO outbox(id,job_id,created_at) VALUES ('duplicate',?,?)",
      )
        .bind(await id(), iso(now))
        .run(),
    ).rejects.toThrow();
  });
});

describe("receipt time after an old storage failure", () => {
  it("recovers newly stored MIME without backdating it to an expired admission intent", async () => {
    const hash = await sha256(fixture());
    await admit(env, hash, now - 40 * 86400000);
    expect(
      (
        await accept("plain.eml", now, {
          ...env,
          DB: failures(env.DB, "batch"),
        })
      ).setReject,
    ).toHaveBeenCalled();
    const stored = await env.RAW_EMAILS.head(objectKey(hash));
    await reconcile(
      { ...env, PROCESSING_ENABLED: "true" },
      now + ORPHAN_GRACE_MS + 60000,
    );
    expect(await job()).toMatchObject({ state: "queued" });
    expect(await query("SELECT received_at FROM messages")).toMatchObject({
      received_at: stored!.uploaded.toISOString(),
    });
    expect(await env.RAW_EMAILS.head(objectKey(hash))).not.toBeNull();
  });
});
