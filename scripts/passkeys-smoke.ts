import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { createTestAuthenticator } from "../server/passkeys/test-authenticator.js";

// Uses disposable synthetic accounts and real signatures, not a bypass API.
const origin = process.argv[2] ?? "https://my-webpage-passkeys.vercel.app";
const target = new URL(origin);
if (!["my-webpage-passkeys.vercel.app", "localhost", "127.0.0.1"].includes(target.hostname) || target.origin !== origin) {
  throw new Error("Only this submission or loopback may be tested.");
}
const steps: unknown[] = [];
const observedTokens = new Set<string>();
function browser() {
  const jar = new Map<string, string>();
  return {
    cookie: () => [...jar].map(([key,value]) => `${key}=${value}`).join("; "),
    async request(label: string, route: string, method = "GET", body?: unknown, explicitCookie?: string) {
      const cookies = explicitCookie ?? [...jar].map(([key,value]) => `${key}=${value}`).join("; ");
      const response = await fetch(`${origin}/api/passkeys/${route}`, {
        method, headers: { Origin: origin, "Content-Type": "application/json", "X-Passkey-Request": "1", Cookie: cookies },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";")[0];
        const separator = pair.indexOf("=");
        const key = pair.slice(0,separator), token = pair.slice(separator+1);
        if (token) { jar.set(key,token); observedTokens.add(token); } else jar.delete(key);
      }
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { unexpectedContent: text.slice(0,200) }; }
      steps.push({ label, request: { method, path: `/api/passkeys/${route}`, ...(body === undefined ? {} : {body}), cookie: cookies ? "[REDACTED]" : "none" },
        response: { status: response.status, body: data, setCookie: response.headers.has("set-cookie") ? "[REDACTED]" : "none" } });
      console.log(`${response.status} ${label}`);
      return {status:response.status,data};
    },
  };
}
type Browser = ReturnType<typeof browser>;
const a=browser(), b=browser(), stranger=browser();
const a1=createTestAuthenticator(), a2=createTestAuthenticator(), b1=createTestAuthenticator();
async function register(client:Browser, authenticator:ReturnType<typeof createTestAuthenticator>, name:string) {
  const options=await client.request(`${name} 등록 challenge`,"register-options","POST",{name});
  assert.equal(options.status,200);
  const result=await client.request(`${name} 등록 검증`,"register-verify","POST",{response:authenticator.registration(options.data.options,origin)});
  assert.equal(result.status,200);
  return result.data;
}
async function login(client:Browser, authenticator:ReturnType<typeof createTestAuthenticator>, label:string, expected=200, wrong=false) {
  const options=await client.request(`${label} challenge`,"login-options","POST",{});
  assert.equal(options.status,200);
  const cookie=client.cookie();
  const body={response:authenticator.authentication(options.data.options,origin,{wrongSignature:wrong})};
  const result=await client.request(label,"login-verify","POST",body);
  assert.equal(result.status,expected);
  return {cookie,body,result};
}

try {
  assert.equal((await stranger.request("비로그인 자료 요청","private")).status,401);
  const c1=await stranger.request("취소할 등록 요청 1","register-options","POST",{name:"취소할 테스트"});
  const c2=await stranger.request("취소할 등록 요청 2","register-options","POST",{name:"취소할 테스트"});
  assert.notEqual(c1.data.options.challenge,c2.data.options.challenge);
  await stranger.request("등록 취소","cancel","POST",{});
  const accountA=await register(a,a1,"테스트 A · 첫 번째 키");
  const withTwo=await register(a,a2,"테스트 A · 두 번째 키");
  assert.equal(withTwo.account.id,accountA.account.id);
  assert.equal(withTwo.credentials.length,2);
  const accountB=await register(b,b1,"테스트 B · 첫 번째 키");
  assert.notEqual(accountA.account.id,accountB.account.id);
  const privateA=(await a.request("A 자기 자료","private")).data;
  const privateB=(await b.request("B 자기 자료","private")).data;
  assert.equal(privateA.items.length,3); assert.equal(privateB.items.length,3);
  assert.equal((await a.request("A에서 B 자료 접근 거절",`private/${privateB.items[0].id}`)).status,403);
  assert.equal((await b.request("B에서 A 자료 접근 거절",`private/${privateA.items[0].id}`)).status,403);
  const afterA=(await a.request("교차 요청 후 A 자료 건수","private")).data;
  const afterB=(await b.request("교차 요청 후 B 자료 건수","private")).data;
  assert.equal(afterA.items.length,3); assert.equal(afterB.items.length,3);
  assert.equal((await a.request("쿼리 계정 위조 무시",`private?accountId=${accountB.account.id}`)).data.account.id,accountA.account.id);
  assert.equal((await a.request("본문 계정 위조 무시","private","POST",{accountId:accountB.account.id})).data.account.id,accountA.account.id);

  let storedPublicKey: unknown = { status:"not checked: DATABASE_URL absent" };
  if(process.env.DATABASE_URL) {
    const connection=new URL(process.env.DATABASE_URL);
    connection.searchParams.set("sslmode","verify-full");
    const pool=new pg.Pool({connectionString:connection.toString(),max:1});
    try {
      const saved=await pool.query("SELECT public_key FROM passkey_credentials WHERE id=$1 AND account_id=$2",[a1.id,accountA.account.id]);
      const value=Buffer.from(saved.rows[0].public_key).toString("base64url");
      assert.equal(value,a1.publicKeyBase64url);
      storedPublicKey={format:"COSE P-256 public key, base64url",value,matchesAuthenticatorPublicKey:true};
    } finally { await pool.end(); }
  }
  const oldSession=a.cookie();
  await a.request("로그아웃","logout","POST",{});
  assert.equal((await stranger.request("로그아웃 세션 재사용 거절","private","GET",undefined,oldSession)).status,401);
  const valid=await login(a,a1,"정상 서명 로그인");
  assert.equal((await stranger.request("사용된 challenge 재사용 거절","login-verify","POST",valid.body,valid.cookie)).status,401);
  const invalid=await login(stranger,a1,"잘못된 서명 거절",401,true);
  assert.notEqual(valid.body.response.response.clientDataJSON,invalid.body.response.response.clientDataJSON);
  await login(a,a2,"두 번째 키 로그인");
  assert.equal((await a.request("첫 번째 키 삭제",`credentials/${a1.id}`,"DELETE")).status,200);
  await login(stranger,a1,"삭제한 키 로그인 거절",401);
  await a.request("남은 키 로그인 전 로그아웃","logout","POST",{});
  await login(a,a2,"삭제 뒤 남은 키 로그인 성공");
  const finalSession=a.cookie();
  assert.equal((await a.request("마지막 키 삭제",`credentials/${a2.id}`,"DELETE")).data.authenticated,false);
  assert.equal((await stranger.request("마지막 키 삭제 후 세션 거절","private","GET",undefined,finalSession)).status,401);
  await b.request("테스트 B 정리",`credentials/${b1.id}`,"DELETE");
  const evidence={ generatedAt:new Date().toISOString(), origin,
    method:"Actual HTTP requests to deployed API / Neon PostgreSQL using disposable P-256 software authenticators. Not physical-device or biometric evidence.",
    credentialsStorage:"Test-only in-memory software keys; actual Google/Apple/Windows/security-key storage remains user verification pending.",
    storedPublicKey, crossAccountCounts:{before:{A:3,B:3},after:{A:3,B:3}}, cleanup:"All test accounts removed through last-key deletion",steps };
  let serialized=JSON.stringify(evidence,null,2);
  for(const token of observedTokens) serialized=serialized.replaceAll(token,"[REDACTED]");
  await mkdir("docs/evidence",{recursive:true});
  await writeFile("docs/evidence/deployed-api.json",serialized+"\n");
  console.log("Evidence saved with all session/challenge-cookie values redacted.");
} catch(error) {
  console.error(error instanceof assert.AssertionError ? error.message : "Live verification failed; no secrets logged.");
  process.exitCode=1;
}
