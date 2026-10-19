import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { parse } from "jsonc-parser";
import {
  validateConfig,
  knownOtherIds,
  configPath,
  verifyIdentity,
  queryPoc,
} from "./agent-poc-environment.mjs";
import { fixtureManifest } from "./agent-poc-fixtures.mjs";
export async function probe(c, request = fetch) {
  validateConfig(c, knownOtherIds());
  const origin = new URL(c.vars.AGENT_RESOURCE).origin;
  const get = async (path) =>
    request(`${origin}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  const metadata = await get("/.well-known/oauth-protected-resource");
  assert.equal(metadata.status, 200);
  const d = await metadata.json();
  assert.equal(d.resource, c.vars.AGENT_RESOURCE);
  assert.deepEqual(d.authorization_servers, [c.vars.AGENT_AUTH_ISSUER]);
  assert.deepEqual(d.scopes_supported, [
    "agent:read:synthetic",
    "agent:submit:synthetic",
  ]);
  const unauthorized = await request(c.vars.AGENT_RESOURCE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(unauthorized.status, 401);
  assert.match(
    unauthorized.headers.get("WWW-Authenticate"),
    /resource_metadata=/,
  );
  for (const path of [
    "/",
    "/api/opportunities",
    "/api/agent/pending-batch",
    "/api/agent/extraction-results",
    "/raw",
    "/debug",
  ])
    assert.equal((await get(path)).status, 404);
  return {
    discovery: true,
    unauthenticatedDenied: true,
    extraRoutesClosed: true,
  };
}
// The admin-only CLI reads private D1 directly. Never add this to the MCP tools.
export async function verifyStored(
  c,
  query = (sql) => queryPoc(c, sql),
  contracts,
) {
  validateConfig(c, knownOtherIds());
  const inventory = (
    await query(
      `SELECT (SELECT COUNT(*) FROM messages) AS messages,(SELECT COUNT(*) FROM agent_fixture_bootstraps) AS bootstraps,(SELECT COUNT(*) FROM agent_submissions) AS submissions,(SELECT COUNT(*) FROM agent_results) AS results,(SELECT COUNT(*) FROM opportunities) AS opportunities,(SELECT COUNT(*) FROM jobs) AS jobs,(SELECT COUNT(*) FROM outbox) AS outbox,(SELECT COUNT(*) FROM attachments) AS attachments,(SELECT COUNT(*) FROM deletion_tombstones) AS tombstones`,
    )
  )[0];
  assert.equal(inventory.messages, 3);
  assert.equal(inventory.bootstraps, 3);
  assert.equal(inventory.submissions, 1);
  assert.equal(inventory.results, 3);
  for (const k of [
    "opportunities",
    "jobs",
    "outbox",
    "attachments",
    "tombstones",
  ])
    assert.equal(inventory[k], 0);
  const rows = await query(
    `SELECT r.payload_json,r.state,r.submission_id,r.batch_id,s.principal,s.request_sha256,s.received_at,s.message_count,b.state AS batch_state,b.principal AS batch_principal,c.state AS claim_state FROM agent_results r JOIN agent_submissions s ON s.id=r.submission_id JOIN agent_batches b ON b.id=r.batch_id JOIN agent_claims c ON c.message_id=r.message_id AND c.batch_id=r.batch_id ORDER BY r.message_id`,
  );
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.submission_id)).size, 1);
  assert.equal(new Set(rows.map((r) => r.batch_id)).size, 1);
  const submission = contracts.SubmissionSchema.parse({
    schemaVersion: 1,
    submissionId: rows[0].submission_id,
    batchId: rows[0].batch_id,
    results: rows.map((r) => JSON.parse(r.payload_json)),
  });
  const expectedCounts = { zero: 0, one: 1, multiple: 2 };
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const principal = hash(
    `${c.vars.AGENT_AUTH_ISSUER}\n${c.vars.AGENT_AUTH_SUBJECT}\n${c.vars.AGENT_AUTH_CLIENT_ID}`,
  );
  const canonical = contracts.SubmissionSchema.parse(submission);
  canonical.results.sort((a, b) => a.messageId.localeCompare(b.messageId));
  const requestHash = hash(
    JSON.stringify({
      schemaVersion: canonical.schemaVersion,
      batchId: canonical.batchId,
      results: canonical.results,
    }),
  );
  for (const r of rows) {
    assert.equal(r.principal, principal);
    assert.equal(r.request_sha256, requestHash);
    assert.equal(r.state, "pending_validation");
    assert.equal(r.batch_state, "submitted");
    assert.equal(r.claim_state, "submitted");
    assert.equal(r.message_count, 3);
    assert.equal(r.principal, r.batch_principal);
  }
  for (const r of submission.results) {
    const f = fixtureManifest.find((f) => f.messageId === r.messageId);
    assert.ok(f);
    assert.equal(r.candidates.length, expectedCounts[f.name]);
    for (const candidate of r.candidates) {
      for (const evidence of candidate.evidence) {
        assert.equal(evidence.messageId, r.messageId);
        assert.equal(
          f.untrustedText.slice(evidence.start, evidence.end),
          evidence.quote,
        );
      }
      for (const [field, value] of Object.entries(candidate.fields))
        if (Array.isArray(value) ? value.length > 0 : value !== null)
          assert.ok(candidate.evidence.some((e) => e.field === field));
    }
  }
  return {
    batchId: submission.batchId,
    submissionId: submission.submissionId,
    messageCount: 3,
    candidateCounts: [0, 1, 2],
    state: "pending_validation",
    publicationCount: 0,
    note: "Structural/evidence checks passed. Human review of factual fields and ChatGPT trace is still required.",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let server;
  try {
    const c = validateConfig(
      parse(readFileSync(configPath, "utf8")),
      knownOtherIds(),
    );
    if (process.argv[2] === "probe")
      console.log(JSON.stringify(await probe(c)));
    else if (process.argv[2] === "results") {
      await verifyIdentity(c);
      server = await createServer({
        server: { middlewareMode: true },
        appType: "custom",
      });
      const contracts = await server.ssrLoadModule(
        "/apps/agent/src/contracts.ts",
      );
      console.log(JSON.stringify(await verifyStored(c, undefined, contracts)));
    } else throw new Error("Unknown verification");
  } catch {
    console.error(
      "PoC verification failed. Inspect only the private synthetic environment; no raw responses or credentials are logged.",
    );
    process.exitCode = 1;
  } finally {
    await server?.close();
  }
}
