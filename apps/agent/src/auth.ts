import { importJWK, jwtVerify, type JWK } from "jose";
import {
  ApiError,
  digest,
  READ_SCOPE,
  WRITE_SCOPE,
  type AgentEnv,
  type Principal,
} from "./common";
export function authConfig(env: AgentEnv) {
  if (!["local", "poc"].includes(env.APP_ENV) || env.AGENT_ENABLED !== "true")
    throw new ApiError(503, "AGENT_DISABLED");
  const url = (value: string | undefined) => {
    if (!value || value.length > 2048)
      throw new ApiError(503, "AUTH_NOT_CONFIGURED");
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ApiError(503, "AUTH_NOT_CONFIGURED");
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== "https:" &&
        !(
          env.APP_ENV === "local" &&
          parsed.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(parsed.hostname)
        ))
    )
      throw new ApiError(503, "AUTH_NOT_CONFIGURED");
    return parsed;
  };
  const resource = url(env.AGENT_RESOURCE),
    issuer = url(env.AGENT_AUTH_ISSUER);
  if (
    resource.pathname !== "/mcp" ||
    !env.AGENT_AUTH_SUBJECT ||
    env.AGENT_AUTH_SUBJECT.length > 200 ||
    !env.AGENT_AUTH_CLIENT_ID ||
    env.AGENT_AUTH_CLIENT_ID.length > 200
  )
    throw new ApiError(503, "AUTH_NOT_CONFIGURED");
  let keys: JWK[];
  try {
    keys = JSON.parse(env.AGENT_AUTH_JWKS_JSON ?? "").keys;
  } catch {
    throw new ApiError(503, "AUTH_NOT_CONFIGURED");
  }
  if (
    !Array.isArray(keys) ||
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some(
      (k) =>
        k.kty !== "RSA" ||
        k.alg !== "RS256" ||
        !k.kid ||
        k.kid.length > 100 ||
        !k.n ||
        k.n.length < 342 ||
        !k.e ||
        k.d ||
        k.p ||
        k.q ||
        k.k,
    )
  )
    throw new ApiError(503, "AUTH_NOT_CONFIGURED");
  return {
    resource: resource.href,
    origin: resource.origin,
    issuer: env.AGENT_AUTH_ISSUER!,
    subject: env.AGENT_AUTH_SUBJECT,
    clientId: env.AGENT_AUTH_CLIENT_ID,
    keys,
  };
}
export async function authenticate(
  request: Request,
  env: AgentEnv,
  now: number,
): Promise<Principal> {
  const cfg = authConfig(env);
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([a-zA-Z0-9_.-]{1,8192})$/.exec(authorization);
  if (!match) throw new ApiError(401, "UNAUTHORIZED");
  try {
    const verified = await jwtVerify(
      match[1],
      async (header) => {
        if (header.alg !== "RS256" || header.jku || header.jwk || header.crit)
          throw new Error("invalid");
        const key = cfg.keys.find((k) => k.kid === header.kid);
        if (!key) throw new Error("invalid");
        return importJWK(key, "RS256");
      },
      {
        algorithms: ["RS256"],
        issuer: cfg.issuer,
        audience: cfg.resource,
        subject: cfg.subject,
        currentDate: new Date(now),
        requiredClaims: [
          "iss",
          "sub",
          "aud",
          "exp",
          "iat",
          "jti",
          "client_id",
          "scope",
        ],
        maxTokenAge: 3600,
      },
    );
    const p = verified.payload,
      seconds = Math.floor(now / 1000);
    if (
      typeof p.exp !== "number" ||
      typeof p.iat !== "number" ||
      !Number.isInteger(p.exp) ||
      !Number.isInteger(p.iat) ||
      p.exp - p.iat > 3600 ||
      p.iat > seconds ||
      p.exp <= seconds ||
      p.client_id !== cfg.clientId ||
      typeof p.jti !== "string" ||
      p.jti.length > 200 ||
      !p.jti ||
      typeof p.scope !== "string" ||
      p.scope.length > 200
    )
      throw new Error("invalid");
    const scopes = p.scope
      .split(" ")
      .filter((s) => s === READ_SCOPE || s === WRITE_SCOPE);
    return {
      id: await digest(`${cfg.issuer}\n${cfg.subject}\n${cfg.clientId}`),
      scopes,
    };
  } catch {
    throw new ApiError(401, "UNAUTHORIZED");
  }
}
export function protectedResource(env: AgentEnv) {
  const cfg = authConfig(env);
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    scopes_supported: [READ_SCOPE, WRITE_SCOPE],
    bearer_methods_supported: ["header"],
  };
}
