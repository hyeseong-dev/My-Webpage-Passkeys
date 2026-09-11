import { readFile } from "node:fs/promises";
import pg from "pg";

// For local execution: node --env-file=.env.local scripts/passkeys-migrate.mjs
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 필요합니다. .env.local 또는 서버 환경변수를 설정하세요.");
  process.exitCode = 1;
} else {
  let pool;
  let client;
  try {
    const connectionUrl = new URL(process.env.DATABASE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(connectionUrl.hostname) &&
        ["require", "prefer", "verify-ca"].includes(connectionUrl.searchParams.get("sslmode") ?? "")) {
      connectionUrl.searchParams.set("sslmode", "verify-full");
    }
    pool = new pg.Pool({ connectionString: connectionUrl.toString(), max: 1, connectionTimeoutMillis: 10_000 });
    const sql = await readFile(new URL("../server/passkeys/schema.sql", import.meta.url), "utf8");
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(809202608)");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("패스키 저장소 준비 완료. 기존 계정과 자료는 유지됩니다.");
  } catch {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* Do not expose a secondary connection error. */ }
    }
    console.error("패스키 저장소 준비에 실패했습니다. 연결 설정과 DB 권한을 확인하세요.");
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool?.end();
  }
}
