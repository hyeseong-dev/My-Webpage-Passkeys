import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPasskeyHandler, hashPasskeyToken } from "./handler.js";
import { createTestAuthenticator } from "./test-authenticator.js";
import { createPasskeyTestHarness } from "./test-harness.js";

let harness: Awaited<ReturnType<typeof createPasskeyTestHarness>>;
before(async () => { harness = await createPasskeyTestHarness(); });
after(async () => { await harness.close(); });
beforeEach(async () => {
  await harness.database.exec("TRUNCATE passkey_accounts,passkey_credentials,passkey_sessions,passkey_challenges,passkey_private_items,passkey_rate_limits CASCADE");
});

type Browser = ReturnType<Awaited<ReturnType<typeof createPasskeyTestHarness>>["browser"]>;
async function register(browser: Browser, name = "연습용 패스키", authenticator = createTestAuthenticator()) {
  const options = await browser.request("register-options", { method: "POST", body: { name } });
  assert.equal(options.status, 200);
  const response = authenticator.registration(options.data.options, harness.origin);
  const result = await browser.request("register-verify", { method: "POST", body: { response } });
  assert.equal(result.status, 200);
  return { authenticator, result, response, options: options.data.options };
}
async function login(browser: Browser, authenticator: ReturnType<typeof createTestAuthenticator>, overrides: Parameters<typeof authenticator.authentication>[2] = {}) {
  const options = await browser.request("login-options", { method: "POST" });
  assert.equal(options.status, 200);
  const response = authenticator.authentication(options.data.options, harness.origin, overrides);
  return browser.request("login-verify", { method: "POST", body: { response } });
}

test("anonymous direct private and credential APIs reject with 401; session never includes dummy content", async () => {
  const browser = harness.browser();
  const session = await browser.request("session");
  assert.deepEqual(session.data, { available: true, authenticated: false });
  for (const route of ["private", "private/00000000-0000-0000-0000-000000000000", "credentials"]) {
    assert.equal((await browser.request(route)).status, 401);
  }
});

test("registration cancellation removes its challenge and creates no accounts, credentials or records", async () => {
  const browser = harness.browser();
  const first = await browser.request("register-options", { method: "POST", body: { name: "노트북" } });
  const second = await browser.request("register-options", { method: "POST", body: { name: "노트북" } });
  assert.notEqual(first.data.options.challenge, second.data.options.challenge);
  assert.equal((await harness.database.query("SELECT * FROM passkey_challenges")).rows.length, 1);
  assert.equal((await browser.request("cancel", { method: "POST" })).status, 200);
  for (const table of ["passkey_challenges", "passkey_accounts", "passkey_credentials", "passkey_private_items"]) {
    assert.equal((await harness.database.query(`SELECT * FROM ${table}`)).rows.length, 0);
  }
});

test("verified registration stores the actual COSE public key and hashed session, then signed login succeeds", async () => {
  const browser = harness.browser();
  const registered = await register(browser);
  const credential = (await harness.database.query<{ public_key: Uint8Array }>("SELECT public_key FROM passkey_credentials")).rows[0];
  assert.equal(Buffer.from(credential.public_key).toString("base64url"), registered.authenticator.publicKeyBase64url);
  const token = browser.cookies.get("passkey_session")!;
  const stored = (await harness.database.query<{ token_hash: string }>("SELECT token_hash FROM passkey_sessions")).rows[0];
  assert.equal(stored.token_hash, hashPasskeyToken(token));
  assert.notEqual(stored.token_hash, token);
  assert.match(String(registered.result.headers.get("set-cookie")), /HttpOnly/);
  assert.match(String(registered.result.headers.get("set-cookie")), /SameSite=Strict/);
  assert.match(String(registered.result.headers.get("set-cookie")), /Secure/);
  assert.equal((await browser.request("private")).data.items.length, 3);
  const oldCookie = browser.cookieHeader();
  assert.equal((await browser.request("logout", { method: "POST" })).status, 200);
  assert.equal((await browser.request("private", { cookie: oldCookie })).status, 401);
  assert.equal((await login(browser, registered.authenticator)).status, 200);
});

test("two accounts remain separate in both directions, including query/body owner spoofing", async () => {
  const a = harness.browser();
  const b = harness.browser();
  const ar = await register(a, "같은 이름");
  const br = await register(b, "같은 이름");
  assert.notEqual(ar.result.data.account.id, br.result.data.account.id);
  const aItems = (await a.request("private")).data.items;
  const bItems = (await b.request("private")).data.items;
  assert.notDeepEqual(aItems, bItems);
  assert.equal((await a.request(`private/${bItems[0].id}`)).status, 403);
  assert.equal((await b.request(`private/${aItems[0].id}`)).status, 403);
  const spoofedQuery = await a.request(`private?account=${br.result.data.account.id}&owner=${br.result.data.account.id}`);
  const spoofedBody = await b.request("private", { method: "POST", body: { account: ar.result.data.account.id, owner: ar.result.data.account.id } });
  assert.deepEqual(spoofedQuery.data.items, aItems);
  assert.deepEqual(spoofedBody.data.items, bItems);
  assert.equal((await a.request(`credentials/${br.authenticator.id}`, { method: "DELETE" })).status, 403);
  assert.deepEqual((await a.request("private")).data.items, aItems);
  assert.deepEqual((await b.request("private")).data.items, bItems);
});

test("adding a passkey stays on the same account and lists names and creation dates", async () => {
  const browser = harness.browser();
  const first = await register(browser, "첫 번째 기기");
  const second = await register(browser, "두 번째 기기");
  assert.equal(first.result.data.account.id, second.result.data.account.id);
  const listed = (await browser.request("credentials")).data.credentials;
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.map((value: { name: string }) => value.name).sort(), ["두 번째 기기", "첫 번째 기기"]);
  assert.ok(listed.every((value: { createdAt: string }) => !Number.isNaN(Date.parse(value.createdAt))));
  assert.equal((await harness.database.query("SELECT * FROM passkey_accounts")).rows.length, 1);
  assert.equal((await harness.database.query("SELECT * FROM passkey_private_items")).rows.length, 3);
});

test("deleting one credential revokes its sessions and logins, while the remaining credential works", async () => {
  const browser = harness.browser();
  const first = await register(browser, "첫 번째 기기");
  const firstSession = browser.cookieHeader();
  const second = await register(browser, "두 번째 기기");
  const removed = await browser.request(`credentials/${first.authenticator.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.authenticated, true);
  assert.equal(removed.data.credentials.length, 1);
  assert.equal((await browser.request("private", { cookie: firstSession })).status, 401);
  await browser.request("logout", { method: "POST" });
  assert.equal((await login(browser, first.authenticator)).status, 401);
  assert.equal((await login(browser, second.authenticator)).status, 200);
});

test("deleting current credential signs out and deleting the last credential removes unrecoverable dummy account", async () => {
  const browser = harness.browser();
  const first = await register(browser);
  const second = await register(browser);
  const removed = await browser.request(`credentials/${second.authenticator.id}`, { method: "DELETE" });
  assert.equal(removed.data.authenticated, false);
  assert.equal((await browser.request("private")).status, 401);
  assert.equal((await login(browser, first.authenticator)).status, 200);
  const oldCookie = browser.cookieHeader();
  const last = await browser.request(`credentials/${first.authenticator.id}`, { method: "DELETE" });
  assert.equal(last.data.authenticated, false);
  assert.equal((await browser.request("private", { cookie: oldCookie })).status, 401);
  assert.equal((await login(browser, first.authenticator)).status, 401);
  for (const table of ["passkey_accounts", "passkey_private_items", "passkey_sessions"]) {
    assert.equal((await harness.database.query(`SELECT * FROM ${table}`)).rows.length, 0);
  }
});

test("fresh login challenges differ and a previously used challenge is rejected even with original cookie", async () => {
  const browser = harness.browser();
  const { authenticator } = await register(browser);
  await browser.request("logout", { method: "POST" });
  const first = await browser.request("login-options", { method: "POST" });
  const second = await browser.request("login-options", { method: "POST" });
  assert.notEqual(first.data.options.challenge, second.data.options.challenge);
  const response = authenticator.authentication(second.data.options, harness.origin);
  const oldCookie = browser.cookieHeader();
  assert.equal((await browser.request("login-verify", { method: "POST", body: { response } })).status, 200);
  assert.equal((await browser.request("login-verify", { method: "POST", body: { response }, cookie: oldCookie })).status, 401);
});

test("bad signature consumes the challenge; correcting and replaying it is still rejected", async () => {
  const browser = harness.browser();
  const { authenticator } = await register(browser);
  await browser.request("logout", { method: "POST" });
  const options = await browser.request("login-options", { method: "POST" });
  const cookie = browser.cookieHeader();
  const bad = authenticator.authentication(options.data.options, harness.origin, { wrongSignature: true });
  assert.equal((await browser.request("login-verify", { method: "POST", body: { response: bad } })).status, 401);
  const good = authenticator.authentication(options.data.options, harness.origin);
  assert.equal((await browser.request("login-verify", { method: "POST", body: { response: good }, cookie })).status, 401);
  assert.equal((await browser.request("private")).status, 401);
});

test("origin, rpID hash, user verification, userHandle and counter are checked against stored credential", async () => {
  const browser = harness.browser();
  const { authenticator } = await register(browser);
  await browser.request("logout", { method: "POST" });
  for (const overrides of [{ rpId: "wrong.example" }, { userVerified: false }, { userHandle: "wrong-user" }]) {
    assert.equal((await login(browser, authenticator, overrides)).status, 401);
  }
  const options = await browser.request("login-options", { method: "POST" });
  const response = authenticator.authentication(options.data.options, "https://wrong.example");
  assert.equal((await browser.request("login-verify", { method: "POST", body: { response } })).status, 401);
  assert.equal((await login(browser, authenticator, { counter: 100 })).status, 200);
  await browser.request("logout", { method: "POST" });
  assert.equal((await login(browser, authenticator, { counter: 99 })).status, 401);
});

test("registration rejects invalid origin, rpID and missing user verification without persisting an account", async () => {
  const browser = harness.browser();
  for (const overrides of [{ userVerified: false }, { rpId: "wrong.example" }, {}]) {
    const options = await browser.request("register-options", { method: "POST", body: { name: "연습" } });
    const authenticator = createTestAuthenticator();
    const response = authenticator.registration(options.data.options, Object.keys(overrides).length ? harness.origin : "https://wrong.example", overrides);
    assert.equal((await browser.request("register-verify", { method: "POST", body: { response } })).status, 400);
  }
  assert.equal((await harness.database.query("SELECT * FROM passkey_accounts")).rows.length, 0);
});

test("challenge is bound to issuing browser cookie and expires after its server TTL", async () => {
  const a = harness.browser();
  const b = harness.browser();
  const { authenticator } = await register(a);
  const options = await a.request("login-options", { method: "POST" });
  const response = authenticator.authentication(options.data.options, harness.origin);
  assert.equal((await b.request("login-verify", { method: "POST", body: { response } })).status, 401);
  await harness.database.exec("UPDATE passkey_challenges SET expires_at=now()-interval '1 second'");
  assert.equal((await a.request("login-verify", { method: "POST", body: { response } })).status, 401);
});

test("registration begun in a session cannot attach a key after that session is revoked", async () => {
  const browser = harness.browser();
  await register(browser);
  const options = await browser.request("register-options", { method: "POST", body: { name: "늦은 등록" } });
  const response = createTestAuthenticator().registration(options.data.options, harness.origin);
  const previous = browser.cookieHeader();
  await browser.request("logout", { method: "POST" });
  assert.equal((await browser.request("register-verify", { method: "POST", body: { response }, cookie: previous })).status, 401);
  assert.equal((await harness.database.query("SELECT * FROM passkey_credentials")).rows.length, 1);
});

test("parallel reuse consumes a challenge exactly once", async () => {
  const browser = harness.browser();
  const { authenticator } = await register(browser);
  await browser.request("logout", { method: "POST" });
  const options = await browser.request("login-options", { method: "POST" });
  const response = authenticator.authentication(options.data.options, harness.origin);
  const cookie = browser.cookieHeader();
  const results = await Promise.all([
    browser.request("login-verify", { method: "POST", body: { response }, cookie }),
    browser.request("login-verify", { method: "POST", body: { response }, cookie }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  assert.equal((await harness.database.query("SELECT * FROM passkey_sessions")).rows.length, 1);
});

test("parallel credential deletion and login never leave an authorized session for deleted key", async () => {
  const owner = harness.browser();
  const key = await register(owner);
  const other = harness.browser();
  const options = await other.request("login-options", { method: "POST" });
  const response = key.authenticator.authentication(options.data.options, harness.origin);
  await Promise.all([
    owner.request(`credentials/${key.authenticator.id}`, { method: "DELETE" }),
    other.request("login-verify", { method: "POST", body: { response } }),
  ]);
  assert.equal((await other.request("private")).status, 401);
  assert.equal((await harness.database.query("SELECT * FROM passkey_sessions")).rows.length, 0);
});

test("mutations reject foreign Origin and missing custom header; body and request volume are bounded", async () => {
  const browser = harness.browser();
  assert.equal((await browser.request("login-options", { method: "POST", origin: "https://attacker.example" })).status, 403);
  assert.equal((await browser.request("login-options", { method: "POST", header: null })).status, 403);
  assert.equal((await browser.request("register-options", { method: "POST", body: { name: "x".repeat(70_000) } })).status, 413);
  await harness.database.exec("UPDATE passkey_rate_limits SET request_count=40");
  assert.equal((await browser.request("login-options", { method: "POST" })).status, 429);
});

test("unconfigured database fails closed with no authentication bypass", async () => {
  const handler = createPasskeyHandler({ database: () => null });
  for (const route of ["session", "private"]) {
    let result: any;
    const res = { statusCode: 200, setHeader() {}, end(data: string) { result = JSON.parse(data); } };
    await handler({ url: `/api/passkeys/${route}`, method: "GET", headers: { host: "localhost:4173" }, socket: {} } as IncomingMessage, res as unknown as ServerResponse);
    assert.equal(res.statusCode, 503);
    if (route === "session") assert.equal(result.authenticated, false);
  }
});

test("expired server session is rejected and cancelling an added key keeps the existing login", async () => {
  const browser = harness.browser();
  await register(browser);
  await browser.request("register-options", { method: "POST", body: { name: "취소할 패스키" } });
  await browser.request("cancel", { method: "POST" });
  assert.equal((await browser.request("private")).status, 200);
  assert.equal((await harness.database.query("SELECT * FROM passkey_credentials")).rows.length, 1);
  await harness.database.exec("UPDATE passkey_sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await browser.request("private")).status, 401);
  assert.equal((await browser.request("session")).data.authenticated, false);
});

test("attempting to register an already stored credential rolls back all proposed new account data", async () => {
  const a = harness.browser();
  const b = harness.browser();
  const { authenticator } = await register(a);
  const options = await b.request("register-options", { method: "POST", body: { name: "복제 등록 시도" } });
  const response = authenticator.registration(options.data.options, harness.origin);
  assert.equal((await b.request("register-verify", { method: "POST", body: { response } })).status, 409);
  assert.equal((await harness.database.query("SELECT * FROM passkey_accounts")).rows.length, 1);
  assert.equal((await harness.database.query("SELECT * FROM passkey_credentials")).rows.length, 1);
  assert.equal((await harness.database.query("SELECT * FROM passkey_private_items")).rows.length, 3);
  assert.equal((await b.request("private")).status, 401);
});

test("production forbids loopback origins and every allowed localhost request still requires a passkey", async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const browser = harness.browser();
    assert.equal((await browser.request("login-options", { method: "POST", origin: "http://localhost:4173" })).status, 403);
    process.env.NODE_ENV = "test";
    assert.equal((await browser.request("private", { origin: "http://localhost:4173" })).status, 401);
    assert.equal((await browser.request("login-options", { method: "POST", origin: "http://localhost:4173" })).status, 200);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
