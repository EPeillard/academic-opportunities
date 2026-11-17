// Private ingestion only. There is deliberately no HTTP mailbox API.
export const MAX_BYTES = 20 * 1024 * 1024;

export default {
  async email(message, env) {
    if (message.to.toLowerCase() !== env.INBOX_ADDRESS.toLowerCase()) {
      message.setReject("Unknown recipient");
      return;
    }
    if (message.rawSize > MAX_BYTES) {
      message.setReject("Message exceeds the 20 MiB mailbox limit");
      return;
    }
    const chunks = [];
    let size = 0;
    const reader = message.raw.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        message.setReject("Message exceeds the 20 MiB mailbox limit");
        return;
      }
      chunks.push(value);
    }
    const raw = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = await crypto.subtle.digest("SHA-256", raw);
    const id = Array.from(new Uint8Array(digest), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    // Atomic conditional creation preserves the first receipt on SMTP retries.
    // Await durability; storage failures must propagate so SMTP can retry.
    await env.MAIL.put(`raw/${id}.eml`, raw, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "message/rfc822" },
      customMetadata: {
        receivedAt: new Date().toISOString(),
        envelopeFrom: message.from,
        envelopeTo: message.to,
      },
    });
    console.log(JSON.stringify({ event: "mail_stored", id, bytes: size }));
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
