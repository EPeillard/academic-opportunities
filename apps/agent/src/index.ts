import { authConfig, authenticate, protectedResource } from "./auth";
import { pendingBatch, rateLimit, submitResults } from "./batches";
import { ApiError, MAX_BODY_BYTES, safeLog, type AgentEnv } from "./common";
import { readBounded } from "../../ingestion/src/mime";
import { handleMcp } from "./mcp";
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};
export async function readJson(request: Request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  )
    throw new ApiError(415, "JSON_REQUIRED");
  const declared = request.headers.get("Content-Length");
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)
  )
    throw new ApiError(413, "BODY_TOO_LARGE");
  if (!request.body) throw new ApiError(400, "INVALID_JSON");
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(request.body, MAX_BODY_BYTES, 5000);
  } catch (error) {
    throw new ApiError(
      error instanceof Error && error.message === "MESSAGE_TOO_LARGE"
        ? 413
        : 400,
      "INVALID_BODY",
    );
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}
export async function handleAgentRequest(
  request: Request,
  env: AgentEnv,
  now = Date.now(),
) {
  try {
    const cfg = authConfig(env, now),
      url = new URL(request.url);
    if (
      url.origin !== cfg.origin ||
      (request.headers.has("Origin") &&
        ![cfg.origin, "https://chatgpt.com"].includes(
          request.headers.get("Origin")!,
        ))
    )
      throw new ApiError(403, "ORIGIN_DENIED");
    if (request.url.length > 2048) throw new ApiError(400, "INVALID_URL");
    if (
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp"
    ) {
      if (request.method !== "GET" || url.search)
        throw new ApiError(400, "INVALID_REQUEST");
      return Response.json(protectedResource(env), { headers });
    }
    if (env.APP_ENV === "poc" && url.pathname !== "/mcp")
      throw new ApiError(404, "NOT_FOUND");
    const principal = await authenticate(request, env, now);
    await rateLimit(env, principal, now);
    if (url.pathname === "/mcp") {
      if (url.search || request.method !== "POST")
        throw new ApiError(405, "METHOD_NOT_ALLOWED");
      const response = await handleMcp(
        request,
        await readJson(request),
        env,
        principal,
        now,
      );
      for (const [key, value] of Object.entries(headers))
        if (key !== "Content-Type") response.headers.set(key, value);
      return response;
    }
    if (
      url.pathname === "/api/agent/pending-batch" &&
      request.method === "GET"
    ) {
      const params: Record<string, string> = {};
      for (const [key, value] of url.searchParams) {
        if (key in params) throw new ApiError(400, "INVALID_QUERY");
        params[key] = value;
      }
      return Response.json(await pendingBatch(env, principal, params, now), {
        headers,
      });
    }
    if (
      url.pathname === "/api/agent/extraction-results" &&
      request.method === "POST" &&
      !url.search
    )
      return Response.json(
        await submitResults(env, principal, await readJson(request), now),
        { headers },
      );
    throw new ApiError(404, "NOT_FOUND");
  } catch (error) {
    const failure =
      error instanceof ApiError
        ? error
        : new ApiError(503, "AGENT_UNAVAILABLE");
    if (!(error instanceof ApiError)) safeLog("AGENT_UNAVAILABLE");
    const extra: Record<string, string> = {};
    if (failure.status === 401) {
      try {
        extra["WWW-Authenticate"] =
          `Bearer resource_metadata="${authConfig(env).origin}/.well-known/oauth-protected-resource", error="invalid_token"`;
      } catch {}
    }
    if (failure.status === 429) extra["Retry-After"] = "3600";
    return Response.json(
      { error: failure.code },
      { status: failure.status, headers: { ...headers, ...extra } },
    );
  }
}
export default {
  async fetch(request, env) {
    return handleAgentRequest(request, env);
  },
} satisfies ExportedHandler<AgentEnv>;
