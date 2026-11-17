import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { MAX_BYTES } from "../workers/inbox.mjs";

function fixture(raw = "Subject: Test\r\n\r\nPrivate body", options = {}) {
  const writes = [];
  const rejections = [];
  const bytes = new TextEncoder().encode(raw);
  return {
    writes,
    rejections,
    message: {
      from: "sender@example.org",
      to: "offres@inbox.etiennepeillard.com",
      rawSize: bytes.length,
      raw: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      setReject: (reason) => rejections.push(reason),
      ...options,
    },
    env: {
      INBOX_ADDRESS: "offres@inbox.etiennepeillard.com",
      MAIL: { put: async (...args) => writes.push(args) },
    },
  };
}

test("stores exact MIME bytes including attachments with a stable retry key", async () => {
  const a = fixture();
  const b = fixture();
  await worker.email(a.message, a.env);
  await worker.email(b.message, b.env);
  assert.equal(a.writes[0][0], b.writes[0][0]);
  assert.match(a.writes[0][0], /^raw\/[a-f0-9]{64}\.eml$/);
  assert.equal(
    new TextDecoder().decode(a.writes[0][1]),
    "Subject: Test\r\n\r\nPrivate body",
  );
  assert.deepEqual(a.writes[0][2].onlyIf, { etagDoesNotMatch: "*" });
  assert.equal(a.rejections.length, 0);
});

test("rejects other recipients and oversized messages without writing", async () => {
  for (const options of [
    { to: "other@example.org" },
    { rawSize: MAX_BYTES + 1 },
  ]) {
    const f = fixture("test", options);
    await worker.email(f.message, f.env);
    assert.equal(f.writes.length, 0);
    assert.equal(f.rejections.length, 1);
  }
});

test("checks actual stream size even when advertised size is wrong", async () => {
  const f = fixture("x".repeat(MAX_BYTES + 1), { rawSize: 1 });
  await worker.email(f.message, f.env);
  assert.equal(f.writes.length, 0);
  assert.equal(f.rejections.length, 1);
});

test("storage errors propagate for delivery retry", async () => {
  const f = fixture();
  f.env.MAIL.put = async () => {
    throw new Error("Storage unavailable");
  };
  await assert.rejects(worker.email(f.message, f.env), /Storage unavailable/);
});

test("HTTP cannot read the mailbox", async () => {
  const response = await worker.fetch();
  assert.equal(response.status, 404);
});
