import { receive } from "./intake";
import { consume } from "./processing";
import { maintenanceTick } from "./maintenance";
import { event, type IngestionEnv } from "./types";
export type { IngestionEnv } from "./types";
export default {
  // No public/debug/admin endpoint, even when intake is enabled.
  async fetch(): Promise<Response> {
    return Response.json(
      { error: "Private email ingestion Worker." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  },
  async email(message, env) {
    await receive(message, env);
  },
  async queue(batch, env) {
    await consume(batch, env);
  },
  async scheduled(_controller, env) {
    try {
      await maintenanceTick(env);
    } catch {
      event("RECONCILIATION_FAILED");
      throw new Error("RECONCILIATION_FAILED");
    }
  },
} satisfies ExportedHandler<IngestionEnv>;
