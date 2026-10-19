import { IntakeError } from "./types";
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
// Bounded buffering is intentional: Web Crypto digest is not incremental.
export async function readBounded(
  stream: ReadableStream<Uint8Array>,
  max: number,
  timeoutMs = 10000,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0,
    count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new IntakeError("INVALID_MESSAGE")),
      timeoutMs,
    );
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array) || ++count > 4096)
        throw new IntakeError("INVALID_MESSAGE");
      size += value.byteLength;
      if (size > max) throw new IntakeError("MESSAGE_TOO_LARGE");
      chunks.push(value);
    }
    if (size === 0) throw new IntakeError("INVALID_MESSAGE");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } catch (error) {
    // Do not await a malicious or stalled stream's cancel callback.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    reader.releaseLock();
  }
}
export async function inspectHeaders(bytes: Uint8Array) {
  const prefix = new TextDecoder("utf-8", {
    fatal: false,
    ignoreBOM: true,
  }).decode(bytes.subarray(0, 65540));
  const end = /\r?\n\r?\n/.exec(prefix);
  if (!end || end.index > 65536) throw new IntakeError("INVALID_MESSAGE");
  const block = prefix.slice(0, end.index);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(block))
    throw new IntakeError("INVALID_MESSAGE");
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const ids: string[] = [];
  let previous = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!previous) throw new IntakeError("INVALID_MESSAGE");
      continue;
    }
    const match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line);
    if (!match) throw new IntakeError("INVALID_MESSAGE");
    previous = true;
  }
  // Unfold before reading Message-ID; repeated IDs are malformed, never authoritative.
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const match = /^message-id:[ \t]*(.*)$/i.exec(line);
    if (match) ids.push(match[1].trim());
  }
  if (ids.length === 0)
    return { messageIdHash: null, messageIdKind: "missing" as const };
  if (
    ids.length !== 1 ||
    ids[0].length > 998 ||
    !/^<[^<>\s@]+@[^<>\s@]+>$/.test(ids[0])
  )
    return { messageIdHash: null, messageIdKind: "malformed" as const };
  return {
    messageIdHash: await sha256(new TextEncoder().encode(ids[0])),
    messageIdKind: "valid" as const,
  };
}
