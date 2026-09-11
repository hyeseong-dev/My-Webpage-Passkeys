import pg from "pg";

export interface SqlResult<T = Record<string, unknown>> { rows: T[] }
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<SqlResult<T>>;
}
export interface PasskeyDatabase extends SqlExecutor {
  transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T>;
}

let database: PasskeyDatabase | undefined;

/** Credentials remain in the server's DATABASE_URL and never reach the bundle. */
export function getPasskeyDatabase(): PasskeyDatabase | null {
  if (!process.env.DATABASE_URL) return null;
  if (database) return database;
  const connectionUrl = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(connectionUrl.hostname) &&
      ["require", "prefer", "verify-ca"].includes(connectionUrl.searchParams.get("sslmode") ?? "")) {
    // pg-connection-string is changing these aliases; pin certificate and host verification.
    connectionUrl.searchParams.set("sslmode", "verify-full");
  }
  const pool = new pg.Pool({
    connectionString: connectionUrl.toString(),
    max: 3,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    // DATABASE_URL supplies Neon TLS requirements; do not disable certificate checks.
  });
  pool.on("error", () => console.error("Passkey database connection failed"));
  const query: SqlExecutor["query"] = async (sql, values) => {
    const result = await pool.query(sql, values);
    return { rows: result.rows };
  };
  database = {
    query,
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '15s'");
        const result = await work({
          async query(sql, values) {
            const response = await client.query(sql, values);
            return { rows: response.rows };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return database;
}
