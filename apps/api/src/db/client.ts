import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../env.js";
import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __qatarEduDb?: Db;
};

function createPool(): Pool {
  return new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Lazily-initialized drizzle client. The pg Pool (and env validation) is only
 * created on first query, so importing this module never requires DATABASE_URL
 * — keeping route-factory tests free of a live Postgres.
 */
function createLazyDb(): Db {
  let inner: Db | undefined;
  const resolve = (): Db => {
    inner ??= drizzle(createPool(), { schema });
    return inner;
  };
  return new Proxy({} as Db, {
    get(_target, prop) {
      const real = resolve() as unknown as Record<PropertyKey, unknown>;
      const value = real[prop];
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

// Reuse the client across hot-reloads in dev (tsx watch).
export const db: Db = globalForDb.__qatarEduDb ?? (globalForDb.__qatarEduDb = createLazyDb());

export { schema };
