import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { ArrowUpRight, Check, Fingerprint, KeyRound, LockKeyhole, LogOut, Plus, Trash2 } from "lucide-react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import "./PasskeyVault.css";

type Passkey = { id: string; name: string; createdAt: string };
type Account = { id: string; displayName: string };
type Session = {
  available?: boolean;
  authenticated: boolean;
  account?: Account;
  credentials?: Passkey[];
};
type PrivateItem = { id: string; title: string; body: string };
type Notice = { text: string; kind: "info" | "success" | "error" };
type Operation = "register" | "login" | "logout" | "delete" | "refresh";

const CANONICAL_HOST = "my-webpage-passkeys.vercel.app";
const CANONICAL_URL = `https://${CANONICAL_HOST}/#private-vault`;

class RequestError extends Error {
  constructor(public status: number) {
    super("Passkey request failed");
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`/api/passkeys/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: method === "GET"
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json", "X-Passkey-Request": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new RequestError(response.status);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof RequestError) {
    if (error.status === 401) return "열람 시간이 끝났거나 인증을 확인하지 못했습니다. 패스키로 다시 로그인해 주세요.";
    if (error.status === 403) return "이 요청을 허용할 수 없습니다. 원래 페이지에서 다시 시도해 주세요.";
    if (error.status === 409) return "이미 등록한 패스키이거나 다른 요청이 먼저 처리되었습니다. 목록을 확인한 뒤 다시 시도해 주세요.";
    if (error.status === 429) return "요청이 잠시 많아졌습니다. 조금 기다린 뒤 다시 시도해 주세요.";
    if (error.status >= 500 || error.status === 404) return "지금은 패스키 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    return "요청을 완료하지 못했습니다. 페이지를 새로고침하고 다시 시도해 주세요.";
  }
  if (error instanceof Error && error.name === "InvalidStateError") {
    return "이 저장소에는 같은 계정의 패스키가 이미 있습니다. 다른 기기나 저장소를 선택해 주세요.";
  }
  if (error instanceof Error && error.name === "SecurityError") {
    return "현재 주소에서는 패스키를 사용할 수 없습니다. 정식 홈페이지에서 다시 시도해 주세요.";
  }
  return "인증을 완료하지 못했습니다. 네트워크와 기기의 패스키 설정을 확인한 뒤 다시 시도해 주세요.";
}

function registrationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "등록일 확인 중" : new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  }).format(date);
}

export default function PasskeyVault() {
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<PrivateItem[]>([]);
  const [name, setName] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Passkey | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const hostname = window.location.hostname;
  const correctDomain = [CANONICAL_HOST, "localhost", "127.0.0.1"].includes(hostname);
  const supported = window.isSecureContext && browserSupportsWebAuthn();
  const authenticated = session?.authenticated === true;
  const credentials = session?.credentials ?? [];
  const disabled = operation !== null || !supported || session === null || session.available === false;

  const clearPrivate = useCallback(() => {
    setItems([]);
    setSession((current) => ({ available: current?.available ?? true, authenticated: false }));
    setDeleteTarget(null);
  }, []);

  const refresh = useCallback(async (hideUntilChecked = false) => {
    if (busy.current || !correctDomain) return;
    busy.current = true;
    setOperation("refresh");
    if (hideUntilChecked) setItems([]);
    try {
      const next = await request<Session>("session");
      if (!mounted.current) return;
      setItems([]);
      setSession(next);
      if (next.authenticated) {
        const data = await request<{ account: Account; items: PrivateItem[] }>("private");
        if (!next.account?.id || data.account?.id !== next.account.id) throw new RequestError(401);
        if (mounted.current) setItems(data.items);
      } else {
        setItems([]);
        setDeleteTarget(null);
      }
    } catch (error) {
      if (!mounted.current) return;
      clearPrivate();
      setNotice({ kind: "error", text: friendlyError(error) });
      if (!(error instanceof RequestError && error.status === 401)) {
        setSession({ available: false, authenticated: false });
      }
    } finally {
      busy.current = false;
      if (mounted.current) setOperation(null);
    }
  }, [clearPrivate, correctDomain]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const recheck = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const hidePrivate = () => {
      if (document.visibilityState === "hidden") setItems([]);
      else recheck();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", hidePrivate);
    window.addEventListener("pageshow", recheck);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", hidePrivate);
      window.removeEventListener("pageshow", recheck);
    };
  }, [refresh]);

  const begin = (next: Operation) => {
    if (busy.current) return false;
    busy.current = true;
    setOperation(next);
    setNotice(null);
    return true;
  };
  const finish = () => {
    busy.current = false;
    if (mounted.current) setOperation(null);
  };
  const applySession = async (next: Session) => {
    if (!mounted.current) return;
    setItems([]);
    setSession({ ...next, available: true });
    if (next.authenticated) {
      const data = await request<{ account: Account; items: PrivateItem[] }>("private");
      if (!next.account?.id || data.account?.id !== next.account.id) throw new RequestError(401);
      if (mounted.current) setItems(data.items);
    }
  };

  const authenticate = async (mode: "register" | "login") => {
    if (disabled || !begin(mode)) return;
    const adding = mode === "register" && authenticated;
    let browserStep = false;
    try {
      let next: Session;
      if (mode === "register") {
        const { options } = await request<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
          "register-options", "POST", { name: name.trim() },
        );
        browserStep = true;
        const response = await startRegistration({ optionsJSON: options });
        browserStep = false;
        next = await request<Session>("register-verify", "POST", { response });
      } else {
        const { options } = await request<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
          "login-options", "POST", {},
        );
        browserStep = true;
        const response = await startAuthentication({ optionsJSON: options });
        browserStep = false;
        next = await request<Session>("login-verify", "POST", { response });
      }
      await applySession(next);
      if (mounted.current) {
        setName("");
        setNotice({ kind: "success", text: adding
          ? "이 계정에 패스키를 추가했습니다. 다음 로그인부터 등록한 패스키 중 하나를 사용할 수 있습니다."
          : mode === "register"
            ? "패스키를 등록했습니다. 이 데모 계정만의 비공개 기록이 열렸습니다."
            : "패스키로 로그인했습니다. 이 계정의 비공개 기록을 확인할 수 있습니다." });
      }
    } catch (error) {
      const cancelled = browserStep && error instanceof Error && ["NotAllowedError", "AbortError"].includes(error.name);
      let cancellationConfirmed = false;
      try {
        await request("cancel", "POST", {});
        cancellationConfirmed = true;
      } catch {
        // The server challenge still expires even if the cancellation request cannot reach it.
      }
      if (!mounted.current) return;
      if (error instanceof RequestError && error.status === 401) clearPrivate();
      setNotice({ kind: cancelled ? "info" : "error", text: cancelled
        ? mode === "register"
          ? cancellationConfirmed
            ? "패스키 등록이 취소되었거나 시간이 지났습니다. 새 계정이나 패스키는 서버에 저장되지 않았습니다. 준비되면 다시 시도해 주세요."
            : "패스키 등록을 완료하지 않았습니다. 서버에 취소 확인을 보내지 못했으므로 연결을 확인한 뒤 다시 시도해 주세요."
          : "로그인이 취소되었거나 시간이 지났습니다. 등록한 패스키를 선택해 다시 시도해 주세요."
        : friendlyError(error) });
    } finally {
      finish();
      if (mounted.current) void refresh();
    }
  };

  const register = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setNotice({ kind: "error", text: "나중에 알아볼 수 있도록 패스키 이름을 적어 주세요." });
      return;
    }
    void authenticate("register");
  };

  const logout = async () => {
    if (!begin("logout")) return;
    setItems([]);
    try {
      await request("logout", "POST", {});
      if (!mounted.current) return;
      clearPrivate();
      setName("");
      setNotice({ kind: "success", text: "로그아웃했습니다. 비공개 기록이 다시 잠겼습니다." });
    } catch {
      if (mounted.current) setNotice({ kind: "error", text: "로그아웃을 확인하지 못했습니다. 네트워크 연결을 확인하고 다시 눌러 주세요." });
    } finally {
      finish();
    }
  };

  const deletePasskey = async () => {
    if (!deleteTarget || !begin("delete")) return;
    const deletingLastKey = credentials.length === 1;
    try {
      const next = await request<Session>(`credentials/${encodeURIComponent(deleteTarget.id)}`, "DELETE");
      if (!mounted.current) return;
      setDeleteTarget(null);
      await applySession(next);
      setNotice({ kind: "success", text: next.authenticated
        ? "패스키를 삭제했습니다. 남아 있는 패스키로 이 계정에 로그인할 수 있습니다."
        : deletingLastKey
          ? "마지막 패스키를 삭제해 로그아웃했습니다. 이 계정의 기록에는 다시 접근할 수 없습니다. 새 데모 계정으로 시작할 수 있습니다."
          : "현재 로그인에 사용한 패스키를 삭제해 로그아웃했습니다. 남아 있는 패스키로 다시 로그인해 주세요." });
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof RequestError && error.status === 401) clearPrivate();
      setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      finish();
    }
  };

  return (
    <section className="passkey-vault" id="private-vault" aria-labelledby="vault-heading">
      <div className="vault-heading-row">
        <div className="section-heading">
          <p>PRIVATE · PASSKEY</p>
          <h2 id="vault-heading">나만의 작은 기록함</h2>
        </div>
        <span className={`vault-state ${authenticated ? "is-unlocked" : ""}`}>
          {authenticated ? <Check size={13} aria-hidden="true" /> : <LockKeyhole size={13} aria-hidden="true" />}
          {authenticated ? "열람 중" : "비공개 · 잠김"}
        </span>
      </div>
      <p className="vault-intro">공개된 소개 다음에는, 나만 열 수 있는 공간을 두었습니다. 패스키로 인증하면 이 데모 계정의 기록이 열립니다.</p>
      <p className="vault-synthetic-note">이 기록함의 계정과 자료는 모두 실습용으로 만든 가상 데이터이며, 실제 개인정보를 담지 않습니다.</p>

      {!correctDomain ? (
        <div className="vault-locked-panel">
          <div className="vault-symbol" aria-hidden="true"><Fingerprint size={29} strokeWidth={1.4} /></div>
          <h3>패스키는 정식 홈페이지에서 사용할 수 있어요.</h3>
          <p>등록한 패스키를 계속 사용할 수 있도록 같은 주소에서 시작해 주세요.</p>
          <a className="vault-button vault-primary" href={CANONICAL_URL}>정식 홈페이지로 이동 <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
      ) : (
        <>
          <div className={`vault-notice ${notice ? `is-${notice.kind}` : ""}`} role="status" aria-live="polite" aria-atomic="true">
            {notice?.text ?? (operation === "refresh" ? "기록함의 열람 상태를 확인하고 있습니다." : "")}
          </div>
          {session?.available === false && (
            <div className="vault-service-note">
              <p>지금은 기록함에 연결할 수 없습니다. 잠시 후 다시 확인해 주세요.</p>
              <button className="vault-button vault-secondary" disabled={operation !== null} onClick={() => void refresh()} type="button">연결 다시 확인</button>
            </div>
          )}
          {!supported && <p className="vault-service-note">이 브라우저에서는 패스키를 사용할 수 없습니다. 최신 Chrome, Edge 또는 Safari에서 정식 홈페이지를 열어 주세요.</p>}

          {authenticated ? (
            <div className="vault-open-panel">
              <div className="vault-account-bar">
                <div><span className="vault-eyebrow">지금 열려 있는 계정</span><h3>{session.account?.displayName ?? "데모 계정"}</h3></div>
                <button className="vault-button vault-secondary" type="button" disabled={operation !== null} onClick={() => void logout()}><LogOut size={15} aria-hidden="true" />{operation === "logout" ? "잠그는 중…" : "로그아웃"}</button>
              </div>
              <div className="vault-records" aria-busy={operation === "refresh"}>
                {items.length > 0 ? items.map((item, index) => (
                  <article className="vault-record" key={item.id}>
                    <span className="vault-record-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <h3>{item.title}</h3><p>{item.body}</p>
                  </article>
                )) : <p className="vault-records-pending">비공개 기록을 확인하고 있습니다.</p>}
              </div>
              <div className="vault-key-manager">
                <div className="vault-manager-heading"><KeyRound size={18} aria-hidden="true" /><h3>등록한 패스키</h3><span>{credentials.length}개</span></div>
                <p className="vault-help">기기를 잃어버려도 들어올 수 있도록 다른 기기나 저장소에 두 번째 패스키를 등록해 두세요.</p>
                <ul className="vault-key-list">
                  {credentials.map((credential) => (
                    <li key={credential.id}>
                      <div><strong>{credential.name}</strong><time dateTime={credential.createdAt}>{registrationDate(credential.createdAt)} 등록</time></div>
                      <button className="vault-delete-button" type="button" disabled={operation !== null} onClick={() => setDeleteTarget(credential)} aria-label={`${credential.name} 패스키 삭제`}><Trash2 size={15} aria-hidden="true" /><span>삭제</span></button>
                    </li>
                  ))}
                </ul>
                <form className="vault-register-form" onSubmit={register}>
                  <label htmlFor="vault-key-name">추가할 패스키 이름</label>
                  <div className="vault-input-row"><input id="vault-key-name" type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoComplete="off" placeholder="예: 휴대전화 패스키" required disabled={disabled} aria-describedby="vault-provider-note" /><button className="vault-button vault-primary" type="submit" disabled={disabled || !name.trim()}><Plus size={16} aria-hidden="true" />{operation === "register" ? "등록 중…" : "패스키 추가"}</button></div>
                </form>
                <p className="vault-help" id="vault-provider-note">등록 창에서 직접 선택한 저장 위치를 기억해 주세요. 예: Google 비밀번호 관리자, 기기 자체, 보안 키.</p>
                <p className="vault-recovery-note">모든 패스키를 잃거나 삭제하면 이 계정을 복구할 수 없습니다. 마지막 패스키를 삭제하면 즉시 로그아웃되며, 새 계정을 만들어도 이전 기록은 이어지지 않습니다.</p>
                <p className="vault-help">다른 데모 계정을 만들려면 먼저 로그아웃한 뒤 새 패스키 등록을 진행해 주세요.</p>
              </div>
            </div>
          ) : (
            <div className="vault-locked-panel">
              <div className="vault-symbol" aria-hidden="true"><Fingerprint size={31} strokeWidth={1.4} /></div>
              <h3>비밀번호 대신, 익숙한 기기로.</h3>
              <p>기기의 지문·얼굴 인식이나 화면 잠금으로 인증합니다.<br />처음이라면 패스키를 등록해 데모 계정을 만들어 보세요.</p>
              <button className="vault-button vault-primary vault-login" type="button" disabled={disabled} onClick={() => void authenticate("login")}><KeyRound size={17} aria-hidden="true" />{operation === "login" ? "인증을 기다리는 중…" : "패스키로 로그인"}</button>
              <div className="vault-register-divider"><span>처음 방문했나요?</span></div>
              <form className="vault-register-form" onSubmit={register}>
                <label htmlFor="vault-key-name">패스키 이름 <span>실명 대신 알아보기 쉬운 이름을 적어 주세요.</span></label>
                <div className="vault-input-row"><input id="vault-key-name" type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoComplete="off" placeholder="예: 노트북 패스키" required disabled={disabled} aria-describedby="vault-provider-note" /><button className="vault-button vault-secondary" type="submit" disabled={disabled || !name.trim()}><Plus size={16} aria-hidden="true" />{operation === "register" ? "등록 중…" : "새 데모 계정 만들기"}</button></div>
              </form>
              <p className="vault-help" id="vault-provider-note">인증 창에서 패스키를 저장할 곳을 선택하고, 실습 기록을 위해 그 위치를 기억해 주세요. 등록을 취소하면 계정이 생성되지 않습니다.</p>
              <p className="vault-help">패스키를 모두 잃거나 삭제하면 이전 계정의 기록은 복구할 수 없습니다.</p>
            </div>
          )}
        </>
      )}

      <AlertDialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open && operation !== "delete") setDeleteTarget(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="vault-dialog-overlay" />
          <AlertDialog.Content className="vault-delete-dialog" onEscapeKeyDown={(event) => { if (operation === "delete") event.preventDefault(); }}>
          <div className="vault-dialog-header">
            <AlertDialog.Title className="vault-dialog-title">{credentials.length === 1 ? "마지막 패스키를 삭제할까요?" : "이 패스키를 삭제할까요?"}</AlertDialog.Title>
            <AlertDialog.Description className="vault-dialog-description">
              ‘{deleteTarget?.name}’을(를) 삭제하면 이 패스키로는 더 이상 로그인할 수 없습니다.
              {credentials.length === 1 ? " 즉시 로그아웃되며, 이 계정과 기록에 다시 접근하거나 복구할 수 없습니다. 다른 패스키를 먼저 추가하는 것을 권합니다." : " 현재 로그인에 사용한 패스키라면 로그아웃됩니다. 남아 있는 패스키로는 계속 로그인할 수 있습니다."}
              {" "}기기나 비밀번호 관리자에 저장된 패스키는 자동으로 지워지지 않을 수 있습니다.
            </AlertDialog.Description>
          </div>
          {notice?.kind === "error" && <p className="vault-notice is-error" role="alert">{notice.text}</p>}
          <div className="vault-dialog-footer">
            <AlertDialog.Cancel className="vault-button vault-secondary" disabled={operation === "delete"}>계속 보관하기</AlertDialog.Cancel>
            <AlertDialog.Action className="vault-button vault-confirm-delete" disabled={operation === "delete"} onClick={(event) => { event.preventDefault(); void deletePasskey(); }}>{operation === "delete" ? "삭제 중…" : "패스키 삭제"}</AlertDialog.Action>
          </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
