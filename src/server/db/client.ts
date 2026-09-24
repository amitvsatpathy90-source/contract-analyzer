import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is required.");
  }

  return url;
}

/**
 * Keep one postgres.js client across Next.js development reloads.
 *
 * This avoids creating a new connection pool every time the dev server
 * reloads a server module.
 */
const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
};

const postgresClient =
  globalForDb.postgresClient ??
  postgres(requireDatabaseUrl(), {
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.postgresClient = postgresClient;
}

/**
 * Single server-side Drizzle database entry point.
 *
 * Keep DB access behind this module so routes/services don't construct
 * independent database clients.
 */
export const db = drizzle({
  client: postgresClient,
  schema,
});

export { postgresClient };
