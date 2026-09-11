import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPasskeyHandler } from "./handler.js";
import type { PasskeyDatabase } from "./database.js";

/** Isolated PostgreSQL implementation for tests/evidence; never imported by production. */
export async function createPasskeyTestHarness() {
  const database = new PGlite();
  await database.exec(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  const adapter: PasskeyDatabase = {
    async query<T>(sql: string, values?: unknown[]) { return { rows: (await database.query<T>(sql, values)).rows }; },
    async transaction(work) {
      return database.transaction(async transaction => work({
        async query<T>(sql: string, values?: unknown[]) { return { rows: (await transaction.query<T>(sql, values)).rows }; },
      }));
    },
  };
  const handler = createPasskeyHandler({ database: adapter });
  const origin = "https://my-webpage-passkeys.vercel.app";

  function browser() {
    const jar = new Map<string, string>();
    return {
      cookies: jar,
      async request(path: string, options: { method?: string; body?: unknown; origin?: string; header?: string | null; cookie?: string } = {}) {
        const headers = new Map<string, string | number | readonly string[]>();
        let status = 200;
        let data: any;
        const request = {
          method: options.method ?? "GET", url: `/api/passkeys/${path}`,
          headers: { host: new URL(origin).host, origin: options.origin ?? origin, "content-type": "application/json",
            ...(options.header === null ? {} : { "x-passkey-request": options.header ?? "1" }),
            cookie: options.cookie ?? Array.from(jar, ([key, value]) => `${key}=${value}`).join("; "),
          },
          socket: { remoteAddress: "127.0.0.1" }, body: options.body ?? {},
        } as unknown as IncomingMessage & { body: unknown };
        const response = {
          get statusCode() { return status; }, set statusCode(value: number) { status = value; },
          setHeader(name: string, value: string | number | readonly string[]) { headers.set(name.toLowerCase(), value); return this; },
          getHeader(name: string) { return headers.get(name.toLowerCase()); },
          end(value: string) { data = JSON.parse(value); },
        } as unknown as ServerResponse;
        await handler(request, response);
        const setCookies = headers.get("set-cookie") as string[] | undefined;
        for (const entry of setCookies ?? []) {
          const [pair] = entry.split(";");
          const [name, value] = pair.split("=");
          if (value) jar.set(name, value); else jar.delete(name);
        }
        return { status, data, headers };
      },
      cookieHeader() { return Array.from(jar, ([key, value]) => `${key}=${value}`).join("; "); },
    };
  }
  return { database, adapter, origin, browser, close: () => database.close() };
}
