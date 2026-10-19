export interface IngestionEnv {
  APP_ENV: "local" | "production";
  DB: D1Database;
  RAW_EMAILS: R2Bucket;
  INGESTION_QUEUE: Queue<{ jobId: string }>;
}

// Configuration scaffold only. No email/queue handlers or public storage route.
// Do not attach Email Routing or a queue consumer until durable intake is ready.
export default {
  async fetch(): Promise<Response> {
    return Response.json(
      { error: "Email ingestion is not implemented or enabled." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  },
} satisfies ExportedHandler<IngestionEnv>;
