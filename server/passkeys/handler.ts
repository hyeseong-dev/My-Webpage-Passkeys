import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { PasskeyAccount, PasskeyCredential } from "../../shared/passkeys.js";
import { getPasskeyDatabase, type PasskeyDatabase, type SqlExecutor } from "./database.js";

const SESSION_COOKIE = "passkey_session";
const CHALLENGE_COOKIE = "passkey_challenge";
const COOKIE_PATH = "/api/passkeys";
const CHALLENGE_SECONDS = 5 * 60;
const SESSION_SECONDS = 30 * 60;
const MAX_CREDENTIALS = 10;
const MAX_BODY_BYTES = 64 * 1024;
const CANONICAL_ORIGIN = "https://my-webpage-passkeys.vercel.app";
const CANONICAL_RP_ID = "my-webpage-passkeys.vercel.app";

type Request = IncomingMessage & { body?: unknown };
type AccountRow = { id: string; display_name: string; webauthn_user_id: string };
type SessionRow = AccountRow & { credential_id: string };
type CredentialRow = {
  id: string;
  account_id: string;
  name: string;
  public_key: Uint8Array;
  counter: number | string;
  transports: AuthenticatorTransportFuture[];
  created_at: Date | string;
};
type ChallengeRow = {
  token_hash: string;
  challenge: string;
  kind: "registration" | "authentication";
  account_id: string | null;
  user_id: string | null;
  display_name: string | null;
  credential_name: string | null;
  session_hash: string | null;
  origin: string;
  rp_id: string;
};
type RpContext = { origin: string; rpID: string; secure: boolean };

export class PasskeyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function hashPasskeyToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cookie(req: IncomingMessage, name: string): string {
  const value = String(req.headers.cookie ?? "").split(";")
    .map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}

function sessionHash(req: IncomingMessage): string | null {
  const value = cookie(req, SESSION_COOKIE);
  return value ? hashPasskeyToken(value) : null;
}

function setCookie(res: ServerResponse, name: string, value: string, maxAge: number, secure: boolean) {
  const previous = res.getHeader("Set-Cookie");
  const cookies = Array.isArray(previous) ? previous.map(String) : previous ? [String(previous)] : [];
  const attributes = [`${name}=${value}`, `Path=${COOKIE_PATH}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict"];
  if (secure) attributes.push("Secure");
  res.setHeader("Set-Cookie", [...cookies.filter(entry => !entry.startsWith(`${name}=`)), attributes.join("; ")]);
}

function requestContext(req: IncomingMessage, mutation: boolean): RpContext {
  const productionOrigin = process.env.PASSKEY_ORIGIN || CANONICAL_ORIGIN;
  const productionRp = process.env.PASSKEY_RP_ID || CANONICAL_RP_ID;
  let configured: URL;
  try {
    configured = new URL(productionOrigin);
    if (configured.origin !== productionOrigin || configured.protocol !== "https:" || configured.hostname !== productionRp) throw new Error();
  } catch {
    throw new PasskeyError(503, "패스키 서비스 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.");
  }

  const origins = new Map<string, RpContext>([[productionOrigin, { origin: productionOrigin, rpID: productionRp, secure: true }]]);
  if (process.env.NODE_ENV !== "production") {
    const localOrigins = (process.env.PASSKEY_DEV_ORIGINS || "http://localhost:4173,http://127.0.0.1:4173").split(",");
    for (const origin of localOrigins.map(value => value.trim()).filter(Boolean)) {
      try {
        const url = new URL(origin);
        if (url.origin === origin && ["localhost", "127.0.0.1"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol)) {
          origins.set(origin, { origin, rpID: url.hostname, secure: url.protocol === "https:" });
        }
      } catch { /* Invalid optional loopback origins are not trusted. */ }
    }
  }

  const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const context = requestOrigin ? origins.get(requestOrigin) : Array.from(origins.values()).find(value => new URL(value.origin).host === req.headers.host);
  if (mutation && (!context || !requestOrigin || req.headers["x-passkey-request"] !== "1")) {
    throw new PasskeyError(403, "허용된 홈페이지에서 다시 요청해 주세요.");
  }
  return context ?? { origin: productionOrigin, rpID: productionRp, secure: true };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Cookie, Origin");
  res.end(JSON.stringify(body));
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new PasskeyError(415, "JSON 형식으로 요청해 주세요.");
  }
  if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) throw new PasskeyError(413, "요청 크기가 너무 큽니다.");
  let parsed = req.body;
  if (parsed !== undefined) {
    if (Buffer.byteLength(typeof parsed === "string" ? parsed : JSON.stringify(parsed), "utf8") > MAX_BODY_BYTES) {
      throw new PasskeyError(413, "요청 크기가 너무 큽니다.");
    }
  } else {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) throw new PasskeyError(413, "요청 크기가 너무 큽니다.");
      chunks.push(buffer);
    }
    parsed = Buffer.concat(chunks).toString("utf8");
  }
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed || "{}"); }
    catch { throw new PasskeyError(400, "요청 내용을 확인해 주세요."); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new PasskeyError(400, "요청 내용을 확인해 주세요.");
  return parsed as Record<string, unknown>;
}

function account(row: AccountRow): PasskeyAccount { return { id: row.id, displayName: row.display_name }; }

async function credentials(sql: SqlExecutor, accountId: string): Promise<PasskeyCredential[]> {
  const result = await sql.query<CredentialRow>("SELECT id, name, created_at FROM passkey_credentials WHERE account_id=$1 ORDER BY created_at, id", [accountId]);
  return result.rows.map(row => ({ id: row.id, name: row.name, createdAt: new Date(row.created_at).toISOString() }));
}

async function readSession(sql: SqlExecutor, tokenHash: string | null): Promise<SessionRow | null> {
  if (!tokenHash) return null;
  const result = await sql.query<SessionRow>(
    `SELECT a.id, a.display_name, a.webauthn_user_id, s.credential_id
     FROM passkey_sessions s JOIN passkey_accounts a ON a.id=s.account_id
     JOIN passkey_credentials c ON c.id=s.credential_id AND c.account_id=s.account_id
     WHERE s.token_hash=$1 AND s.expires_at > now()`, [tokenHash]);
  return result.rows[0] ?? null;
}

/** Account row is the common lock order for registration, login, logout and deletion. */
async function requireLockedSession(sql: SqlExecutor, tokenHash: string | null): Promise<SessionRow> {
  const candidate = await readSession(sql, tokenHash);
  if (!candidate) throw new PasskeyError(401, "패스키로 로그인해 주세요.");
  await sql.query("SELECT id FROM passkey_accounts WHERE id=$1 FOR UPDATE", [candidate.id]);
  const current = await readSession(sql, tokenHash);
  if (!current) throw new PasskeyError(401, "세션이 만료되었습니다. 패스키로 다시 로그인해 주세요.");
  return current;
}

async function issueSession(sql: SqlExecutor, accountId: string, credentialId: string, oldHash: string | null) {
  if (oldHash) await sql.query("DELETE FROM passkey_sessions WHERE token_hash=$1", [oldHash]);
  const token = randomBytes(32).toString("base64url");
  await sql.query(
    "INSERT INTO passkey_sessions(token_hash,account_id,credential_id,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 second')",
    [hashPasskeyToken(token), accountId, credentialId, SESSION_SECONDS]);
  return token;
}

async function discardChallenge(sql: SqlExecutor, req: IncomingMessage) {
  const token = cookie(req, CHALLENGE_COOKIE);
  if (token) await sql.query("DELETE FROM passkey_challenges WHERE token_hash=$1", [hashPasskeyToken(token)]);
}

async function consumeChallenge(sql: SqlExecutor, req: IncomingMessage, res: ServerResponse, context: RpContext, kind: ChallengeRow["kind"]): Promise<ChallengeRow> {
  const token = cookie(req, CHALLENGE_COOKIE);
  setCookie(res, CHALLENGE_COOKIE, "", 0, context.secure);
  if (!token) throw new PasskeyError(401, "인증 요청이 없거나 만료되었습니다. 다시 시작해 주세요.");
  // This committed DELETE is intentionally outside the verification transaction:
  // failed signatures and rolled-back writes must never restore a used challenge.
  const result = await sql.query<ChallengeRow>(
    "DELETE FROM passkey_challenges WHERE token_hash=$1 AND expires_at>now() RETURNING *", [hashPasskeyToken(token)]);
  const row = result.rows[0];
  if (!row || row.kind !== kind || row.origin !== context.origin || row.rp_id !== context.rpID) {
    throw new PasskeyError(401, "이미 사용했거나 만료된 인증 요청입니다. 다시 시작해 주세요.");
  }
  return row;
}

async function saveChallenge(sql: SqlExecutor, req: IncomingMessage, res: ServerResponse, context: RpContext, data: {
  challenge: string;
  kind: ChallengeRow["kind"];
  accountId?: string;
  userId?: string;
  displayName?: string;
  name?: string;
  session?: string | null;
}) {
  await discardChallenge(sql, req);
  const token = randomBytes(32).toString("base64url");
  await sql.query(
    `INSERT INTO passkey_challenges(token_hash,challenge,kind,account_id,user_id,display_name,credential_name,session_hash,origin,rp_id,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+$11*interval '1 second')`,
    [hashPasskeyToken(token), data.challenge, data.kind, data.accountId ?? null, data.userId ?? null,
      data.displayName ?? null, data.name ?? null, data.session ?? null, context.origin, context.rpID, CHALLENGE_SECONDS]);
  setCookie(res, CHALLENGE_COOKIE, token, CHALLENGE_SECONDS, context.secure);
}

async function rateLimit(sql: SqlExecutor, req: IncomingMessage) {
  // The platform-provided forwarding value is used only for throttling, never identity.
  const ip = process.env.VERCEL ? String(req.headers["x-vercel-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown") : req.socket.remoteAddress ?? "unknown";
  const bucket = hashPasskeyToken(`${new Date().toISOString().slice(0, 10)}:${ip}`);
  const result = await sql.query<{ request_count: number }>(
    `INSERT INTO passkey_rate_limits(bucket_hash,window_start,request_count) VALUES($1,date_trunc('minute',now()),1)
     ON CONFLICT(bucket_hash,window_start) DO UPDATE SET request_count=passkey_rate_limits.request_count+1
     RETURNING request_count`, [bucket]);
  if (result.rows[0].request_count > 40) throw new PasskeyError(429, "요청이 많습니다. 잠시 후 다시 시도해 주세요.");
}

async function cleanup(sql: SqlExecutor) {
  await sql.query("DELETE FROM passkey_challenges WHERE expires_at<=now()");
  await sql.query("DELETE FROM passkey_sessions WHERE expires_at<=now()");
  await sql.query("DELETE FROM passkey_rate_limits WHERE window_start<now()-interval '1 day'");
}

async function createDummyItems(sql: SqlExecutor, owner: AccountRow) {
  const suffix = owner.id.slice(0, 8);
  const items = [
    { title: "나의 연습 노트", body: `${owner.display_name}의 가상 기록 ${suffix}-A입니다. 오늘은 로그인한 사람에게만 자료를 보여 주는 흐름을 연습했습니다.` },
    { title: "다음 학습 계획", body: `${owner.display_name}의 가상 계획 ${suffix}-B입니다. 다음 시간에는 두 번째 패스키를 등록하고 기기를 바꿔 로그인할 예정입니다.` },
    { title: "프로젝트 아이디어", body: `${owner.display_name}의 가상 아이디어 ${suffix}-C입니다. 개인 학습 자료를 계정별로 보관하는 작은 앱을 구상했습니다.` },
  ];
  for (let position = 0; position < items.length; position++) {
    const item = items[position];
    await sql.query("INSERT INTO passkey_private_items(id,account_id,title,body,position) VALUES($1,$2,$3,$4,$5)", [randomUUID(), owner.id, item.title, item.body, position]);
  }
}

/** Production uses PostgreSQL; dependency injection exists only in server-side tests. */
export function createPasskeyHandler(options: { database?: PasskeyDatabase | (() => PasskeyDatabase | null) } = {}) {
  return async function handle(req: Request, res: ServerResponse): Promise<boolean> {
    const pathname = new URL(req.url ?? "/", "https://internal.invalid").pathname;
    if (!pathname.startsWith("/api/passkeys/")) return false;
    const route = pathname.slice("/api/passkeys/".length).replace(/\/$/, "");
    const method = req.method ?? "GET";
    try {
      const mutation = !["GET", "HEAD"].includes(method);
      const context = requestContext(req, mutation);
      const database = typeof options.database === "function" ? options.database() : options.database ?? getPasskeyDatabase();
      if (!database) throw new PasskeyError(503, "패스키 저장소 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
      const tokenHash = sessionHash(req);

      if (route === "session" && method === "GET") {
        await database.query("SELECT 1 FROM passkey_accounts LIMIT 1");
        const current = await readSession(database, tokenHash);
        if (!current) {
          if (tokenHash) setCookie(res, SESSION_COOKIE, "", 0, context.secure);
          json(res, 200, { available: true, authenticated: false });
        } else json(res, 200, { available: true, authenticated: true, account: account(current), credentials: await credentials(database, current.id) });
        return true;
      }

      if (["register-options", "register-verify", "login-options", "login-verify"].includes(route) && method === "POST") {
        await rateLimit(database, req);
      }

      if (route === "register-options" && method === "POST") {
        const input = await body(req);
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) throw new PasskeyError(400, "패스키 이름을 1~64자로 입력해 주세요.");
        await cleanup(database);
        const current = await readSession(database, tokenHash);
        const accountId = current?.id ?? randomUUID();
        const userId = current?.webauthn_user_id ?? randomBytes(32).toString("base64url");
        const displayName = current?.display_name ?? `연습 계정 ${accountId.slice(0, 8)}`;
        const existing = current ? await credentials(database, current.id) : [];
        if (existing.length >= MAX_CREDENTIALS) throw new PasskeyError(409, "패스키는 계정당 최대 10개까지 등록할 수 있습니다.");
        const registration = await generateRegistrationOptions({
          rpName: "패스키 · 나만의 연습 공간", rpID: context.rpID,
          userID: new Uint8Array(Buffer.from(userId, "base64url")), userName: displayName, userDisplayName: displayName,
          attestationType: "none", timeout: CHALLENGE_SECONDS * 1000,
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          excludeCredentials: existing.map(item => ({ id: item.id })),
          supportedAlgorithmIDs: [-7, -257],
        });
        await saveChallenge(database, req, res, context, {
          kind: "registration", challenge: registration.challenge, accountId, userId, displayName, name,
          session: current ? tokenHash : null,
        });
        json(res, 200, { options: registration });
        return true;
      }

      if (route === "register-verify" && method === "POST") {
        const input = await body(req);
        const challenge = await consumeChallenge(database, req, res, context, "registration");
        let verified;
        try {
          verified = await verifyRegistrationResponse({ response: input.response as RegistrationResponseJSON,
            expectedChallenge: challenge.challenge, expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id,
            requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
        } catch { throw new PasskeyError(400, "패스키 등록 응답을 확인하지 못했습니다. 다시 등록해 주세요."); }
        if (!verified.verified || !verified.registrationInfo || !challenge.account_id || !challenge.user_id || !challenge.credential_name) {
          throw new PasskeyError(400, "패스키 등록을 확인하지 못했습니다. 다시 시도해 주세요.");
        }
        const info = verified.registrationInfo;
        const result = await database.transaction(async sql => {
          let owner: AccountRow;
          if (challenge.session_hash) {
            if (challenge.session_hash !== tokenHash) throw new PasskeyError(401, "로그인 상태가 바뀌었습니다. 다시 시작해 주세요.");
            owner = await requireLockedSession(sql, tokenHash);
            if (owner.id !== challenge.account_id || owner.webauthn_user_id !== challenge.user_id) throw new PasskeyError(403, "현재 계정에 등록할 수 없는 요청입니다.");
          } else {
            if (await readSession(sql, tokenHash)) throw new PasskeyError(409, "로그인 상태가 바뀌었습니다. 다시 시작해 주세요.");
            owner = { id: challenge.account_id!, webauthn_user_id: challenge.user_id!, display_name: challenge.display_name! };
            await sql.query("INSERT INTO passkey_accounts(id,display_name,webauthn_user_id) VALUES($1,$2,$3)", [owner.id, owner.display_name, owner.webauthn_user_id]);
            await createDummyItems(sql, owner);
          }
          if ((await credentials(sql, owner.id)).length >= MAX_CREDENTIALS) throw new PasskeyError(409, "패스키는 계정당 최대 10개까지 등록할 수 있습니다.");
          await sql.query(
            `INSERT INTO passkey_credentials(id,account_id,name,public_key,counter,transports,device_type,backed_up)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [info.credential.id, owner.id, challenge.credential_name, Buffer.from(info.credential.publicKey), info.credential.counter,
              JSON.stringify(info.credential.transports ?? []), info.credentialDeviceType, info.credentialBackedUp]);
          const token = await issueSession(sql, owner.id, info.credential.id, tokenHash);
          return { token, owner, credentials: await credentials(sql, owner.id) };
        });
        setCookie(res, SESSION_COOKIE, result.token, SESSION_SECONDS, context.secure);
        json(res, 200, { authenticated: true, account: account(result.owner), credentials: result.credentials });
        return true;
      }

      if (route === "login-options" && method === "POST") {
        await body(req);
        await cleanup(database);
        const authentication = await generateAuthenticationOptions({ rpID: context.rpID, userVerification: "required", timeout: CHALLENGE_SECONDS * 1000 });
        await saveChallenge(database, req, res, context, { kind: "authentication", challenge: authentication.challenge });
        json(res, 200, { options: authentication });
        return true;
      }

      if (route === "login-verify" && method === "POST") {
        const input = await body(req);
        const challenge = await consumeChallenge(database, req, res, context, "authentication");
        const response = input.response as AuthenticationResponseJSON;
        if (!response || typeof response.id !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(response.id)) {
          throw new PasskeyError(401, "등록된 패스키로 인증하지 못했습니다.");
        }
        const result = await database.transaction(async sql => {
          const candidate = (await sql.query<{ account_id: string }>("SELECT account_id FROM passkey_credentials WHERE id=$1", [response.id])).rows[0];
          if (!candidate) throw new PasskeyError(401, "등록된 패스키로 인증하지 못했습니다.");
          const owner = (await sql.query<AccountRow>("SELECT * FROM passkey_accounts WHERE id=$1 FOR UPDATE", [candidate.account_id])).rows[0];
          const saved = (await sql.query<CredentialRow>("SELECT * FROM passkey_credentials WHERE id=$1 AND account_id=$2", [response.id, candidate.account_id])).rows[0];
          if (!owner || !saved || response.response?.userHandle !== owner.webauthn_user_id) throw new PasskeyError(401, "등록된 패스키로 인증하지 못했습니다.");
          let verified;
          try {
            verified = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge,
              expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, requireUserVerification: true,
              credential: { id: saved.id, publicKey: new Uint8Array(saved.public_key), counter: Number(saved.counter), transports: saved.transports } });
          } catch { throw new PasskeyError(401, "패스키 서명을 확인하지 못했습니다. 다시 로그인해 주세요."); }
          if (!verified.verified) throw new PasskeyError(401, "패스키 서명을 확인하지 못했습니다. 다시 로그인해 주세요.");
          await sql.query("UPDATE passkey_credentials SET counter=$2,last_used_at=now(),backed_up=$3 WHERE id=$1", [saved.id, verified.authenticationInfo.newCounter, verified.authenticationInfo.credentialBackedUp]);
          const token = await issueSession(sql, owner.id, saved.id, tokenHash);
          return { token, owner, credentials: await credentials(sql, owner.id) };
        });
        setCookie(res, SESSION_COOKIE, result.token, SESSION_SECONDS, context.secure);
        json(res, 200, { authenticated: true, account: account(result.owner), credentials: result.credentials });
        return true;
      }

      if (route === "cancel" && method === "POST") {
        await discardChallenge(database, req);
        setCookie(res, CHALLENGE_COOKIE, "", 0, context.secure);
        json(res, 200, { cancelled: true });
        return true;
      }

      if (route === "logout" && method === "POST") {
        await database.transaction(async sql => {
          const current = await readSession(sql, tokenHash);
          if (current) await sql.query("SELECT id FROM passkey_accounts WHERE id=$1 FOR UPDATE", [current.id]);
          if (tokenHash) await sql.query("DELETE FROM passkey_sessions WHERE token_hash=$1", [tokenHash]);
          await discardChallenge(sql, req);
        });
        setCookie(res, CHALLENGE_COOKIE, "", 0, context.secure);
        setCookie(res, SESSION_COOKIE, "", 0, context.secure);
        json(res, 200, { authenticated: false });
        return true;
      }

      if ((route === "private" && ["GET", "POST"].includes(method)) || (route.startsWith("private/") && method === "GET")) {
        if (method === "POST") await body(req); // Owner/account parameters are deliberately ignored.
        const result = await database.transaction(async sql => {
          const current = await requireLockedSession(sql, tokenHash);
          if (route !== "private") {
            const id = route.slice("private/".length);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new PasskeyError(403, "이 자료를 열람할 권한이 없습니다.");
            const items = await sql.query("SELECT id,title,body FROM passkey_private_items WHERE id=$1 AND account_id=$2", [id, current.id]);
            if (!items.rows.length) throw new PasskeyError(403, "이 자료를 열람할 권한이 없습니다.");
            return { account: account(current), items: items.rows };
          }
          const items = await sql.query("SELECT id,title,body FROM passkey_private_items WHERE account_id=$1 ORDER BY position", [current.id]);
          return { account: account(current), items: items.rows };
        });
        json(res, 200, result);
        return true;
      }

      if (route === "credentials" && method === "GET") {
        const result = await database.transaction(async sql => {
          const current = await requireLockedSession(sql, tokenHash);
          return { account: account(current), credentials: await credentials(sql, current.id) };
        });
        json(res, 200, result);
        return true;
      }

      if (route.startsWith("credentials/") && method === "DELETE") {
        const id = route.slice("credentials/".length);
        const result = await database.transaction(async sql => {
          const current = await requireLockedSession(sql, tokenHash);
          const removed = await sql.query("DELETE FROM passkey_credentials WHERE id=$1 AND account_id=$2 RETURNING id", [id, current.id]);
          if (!removed.rows.length) throw new PasskeyError(403, "현재 계정의 패스키만 삭제할 수 있습니다.");
          const remaining = await credentials(sql, current.id);
          if (!remaining.length) {
            await sql.query("DELETE FROM passkey_challenges WHERE account_id=$1", [current.id]);
            await sql.query("DELETE FROM passkey_accounts WHERE id=$1", [current.id]);
          }
          const authenticated = !!(await readSession(sql, tokenHash));
          return authenticated ? { authenticated: true, account: account(current), credentials: remaining } : { authenticated: false };
        });
        if (!result.authenticated) setCookie(res, SESSION_COOKIE, "", 0, context.secure);
        json(res, 200, result);
        return true;
      }

      json(res, 404, { error: "요청한 패스키 기능을 찾을 수 없습니다." });
    } catch (error) {
      if (error instanceof PasskeyError) {
        if (error.status === 429) res.setHeader("Retry-After", "60");
        json(res, error.status, { ...(route === "session" ? { available: false, authenticated: false } : {}), error: error.message });
      } else if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        json(res, 409, { error: "이미 등록된 패스키입니다. 다른 패스키를 선택해 주세요." });
      } else {
        // Never log requests, cookies, DB URLs, signatures or public-key material.
        console.error("Passkey request could not be completed");
        json(res, 503, { ...(route === "session" ? { available: false, authenticated: false } : {}), error: "패스키 서비스를 잠시 사용할 수 없습니다. 잠시 후 다시 시도해 주세요." });
      }
    }
    return true;
  };
}

export const handlePasskeyApi = createPasskeyHandler();
