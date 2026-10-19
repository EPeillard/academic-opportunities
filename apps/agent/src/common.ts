export interface AgentEnv {
  APP_ENV: "local" | "poc";
  AGENT_ENABLED?: string;
  AGENT_TEST_EXPIRES_AT?: string;
  AGENT_RESOURCE?: string;
  AGENT_AUTH_ISSUER?: string;
  AGENT_AUTH_SUBJECT?: string;
  AGENT_AUTH_CLIENT_ID?: string;
  AGENT_AUTH_JWKS_JSON?: string;
  DB: D1Database;
}
export const READ_SCOPE = "agent:read:synthetic";
export const WRITE_SCOPE = "agent:submit:synthetic";
export const BATCH_TTL_MS = 15 * 60 * 1000;
export const MAX_BODY_BYTES = 64 * 1024;
export const iso = (now: number) => new Date(now).toISOString();
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export interface Principal {
  id: string;
  scopes: string[];
}
export async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function requireScope(principal: Principal, scope: string) {
  if (!principal.scopes.includes(scope))
    throw new ApiError(403, "INSUFFICIENT_SCOPE");
}
export const safeLog = (code: string) =>
  console.log(JSON.stringify({ event: "agent_poc", code }));
