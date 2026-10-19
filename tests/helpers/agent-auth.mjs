// Ephemeral test-only issuer. Never use these functions as a live OAuth server.
import { generateKeyPair, exportJWK, SignJWT } from "jose";
export async function testIdentity(origin = "http://127.0.0.1:8790") {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    modulusLength: 2048,
  });
  const key = {
    ...(await exportJWK(publicKey)),
    kid: "ephemeral-local",
    alg: "RS256",
    use: "sig",
  };
  const env = {
    APP_ENV: "local",
    AGENT_ENABLED: "true",
    AGENT_RESOURCE: `${origin}/mcp`,
    AGENT_AUTH_ISSUER: "https://issuer.example.org/",
    AGENT_AUTH_SUBJECT: "synthetic-tester",
    AGENT_AUTH_CLIENT_ID: "synthetic-client",
    AGENT_AUTH_JWKS_JSON: JSON.stringify({ keys: [key] }),
  };
  const mint = async (changes = {}, header = {}, at = Date.now()) => {
    const seconds = Math.floor(at / 1000);
    return new SignJWT({
      iss: env.AGENT_AUTH_ISSUER,
      sub: env.AGENT_AUTH_SUBJECT,
      aud: env.AGENT_RESOURCE,
      iat: seconds,
      exp: seconds + 900,
      jti: crypto.randomUUID(),
      client_id: env.AGENT_AUTH_CLIENT_ID,
      scope: "agent:read:synthetic agent:submit:synthetic",
      ...changes,
    })
      .setProtectedHeader({ alg: "RS256", kid: key.kid, ...header })
      .sign(privateKey);
  };
  return { env, key, mint, privateKey };
}
