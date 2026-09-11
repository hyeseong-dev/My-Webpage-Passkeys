# 인증 구현 설명서

기록 기준: 2026-09-11. 이 프로젝트는 가상 인물의 공개 소개와, 패스키로 인증한 계정만 읽을 수 있는 합성 자료를 제공하는 교육용 데모다. 소개·계정·자료는 모두 만들어 넣은 예시이며 실제 개인정보를 사용하지 않는다.

실제 배포 API와 Neon PostgreSQL에 대한 HTTP 검증 36개를 완료했다. 이 검증에는 실제 P-256 키와 서명을 생성하는 **테스트용 소프트웨어 인증기**를 사용했다. Windows Hello, Touch ID, 휴대전화 또는 보안 키에서 사용자가 직접 승인한 기록은 아직 없다. 소프트웨어 검증을 실기기·생체 인증 성공으로 표시하지 않는다.

전체 요청·응답은 [실제 배포 검증 기록](evidence/deployed-api.json)에 있다. 생성 시각은 `2026-09-11T02:01:01.436Z`이며, 테스트 계정은 검증 마지막에 API로 삭제했다. 현재 서비스에 검증용 두 계정이나 두 패스키가 계속 남아 있다는 뜻은 아니다.

## ① 무엇으로 붙였나

인증 방식은 WebAuthn 패스키다. 인증 서비스에 가입자를 위탁하는 방식이 아니라, 검증 라이브러리를 사용하고 계정·challenge·세션·권한 관리는 이 서버에서 구현했다.

| 역할 | 사용한 것 | 범위 |
| --- | --- | --- |
| 브라우저 패스키 호출 | `@simplewebauthn/browser` 13.3.0 | `startRegistration`, `startAuthentication`으로 브라우저 인증 창 호출 |
| 등록·로그인 응답 검증 | `@simplewebauthn/server` 13.3.3 | challenge, Origin, RP ID, 사용자 확인 여부, 공개키와 서명 검증 |
| 화면 | React 19.2.1, Vite 7.1.9 | 공개 소개, 잠긴 기록함, 패스키 등록·관리 |
| API | TypeScript, Vercel Functions | 인증 후 세션 발급, 비공개 자료 접근 제어 |
| 영구 저장소 | Neon PostgreSQL, `pg` 8.23.0 | 공개키와 challenge, 서버 세션 및 가상 계정 자료 저장 |
| 로컬 검증 | Node 테스트 실행기, PGlite, 테스트용 P-256 소프트웨어 인증기 | 독립 DB에서 성공·실패·재사용·교차 계정·동시 요청 검증 |

배포 기준 Origin은 `https://my-webpage-passkeys.vercel.app`, RP ID는 `my-webpage-passkeys.vercel.app`이다. 실습용 공개 제출본을 별도로 구성했으므로 이 제출본의 고정 주소에 패스키를 등록한다. 임시 Preview 주소에서는 정식 주소로 이동하도록 안내한다.

서버에는 [schema.sql](../server/passkeys/schema.sql)의 6개 테이블을 생성했다.

| 테이블 | 보관하는 것 |
| --- | --- |
| `passkey_accounts` | 무작위 계정 ID, 가상 표시 이름, WebAuthn 사용자 핸들 |
| `passkey_credentials` | credential ID, 이름, 등록일, COSE 공개키, 서명 카운터 등 |
| `passkey_challenges` | 일회용 challenge, 용도, 발급 Origin/RP ID, 만료 시각 |
| `passkey_sessions` | 세션 토큰의 SHA-256 해시, 계정, 사용한 credential, 만료 시각 |
| `passkey_private_items` | 계정별 합성 자료 3개 |
| `passkey_rate_limits` | 요청량 제한을 위한 시간대별 카운터 |

비밀번호를 입력하거나 저장하는 기능은 없다. 실기기 패스키를 저장한 실제 위치는 사용자 확인 대기다. 현재 자동 검증의 개인키는 테스트 프로세스의 메모리에만 있었으며 Google 비밀번호 관리자·기기 자체·보안 키 중 어느 곳에 실제 등록했다고 주장하지 않는다.

## ② 왜 그걸 골랐나

패스키 응답을 직접 해석해 암호학적 검증을 새로 작성하기보다, 등록·서명 검증을 담당하는 라이브러리를 선택했다. 계정과 자료의 관계, 일회용 challenge 소비, 로그아웃 이후 세션 폐기는 서버 코드에서 직접 확인할 수 있게 구성했다.

Neon PostgreSQL은 Vercel 함수가 종료되거나 다시 실행되어도 공개키와 세션 상태가 남도록 선택했다. 메모리에만 저장하면 다음 요청에서 등록 상태를 잃을 수 있어, 인증 상태를 영구 저장소에 둔다. 세션과 credential 삭제는 같은 DB 관계와 트랜잭션으로 처리한다.

고정 도메인을 사용해 등록과 로그인 시 같은 RP ID와 Origin을 확인한다. 개발 환경에서만 명시한 loopback 주소를 허용하며, 로컬 주소에서도 비공개 자료를 자동으로 열지 않는다.

## ③ 어디를 어떻게 고쳤나

공개 홈페이지는 [Home.tsx](../client/src/pages/Home.tsx)에 있고, 그 아래에 [PasskeyVault.tsx](../client/src/components/PasskeyVault.tsx)를 붙였다. 공개 소개는 인증 없이 표시된다. 비공개 자료의 본문은 서버 응답을 받은 뒤에만 React 상태에 넣으며, 초기 HTML이나 클라이언트 코드에 자료 본문을 넣지 않는다.

| 흐름 | 화면과 API | 서버 처리와 저장소 |
| --- | --- | --- |
| 등록 | `PasskeyVault.authenticate("register")` → `POST /api/passkeys/register-options` → 브라우저 `startRegistration` → `POST /api/passkeys/register-verify` | `handler.ts`의 `register-options` 분기(282행), `saveChallenge`, `register-verify` 분기(309행), `verifyRegistrationResponse`. 검증 성공 후 계정·공개키·합성 자료를 저장하고 세션 발급 |
| 로그인 | `PasskeyVault.authenticate("login")` → `POST /api/passkeys/login-options` → 브라우저 `startAuthentication` → `POST /api/passkeys/login-verify` | `handler.ts`의 `login-options` 분기(348행), `login-verify` 분기(357행), `verifyAuthenticationResponse`. 저장된 공개키로 서명을 확인한 뒤에만 세션 발급 |
| 로그아웃 | `PasskeyVault.logout` → `POST /api/passkeys/logout` | `handler.ts`의 `logout` 분기(393행). DB의 세션 해시와 진행 중 challenge를 삭제하고 쿠키를 만료시킴 |
| 비공개 자료 조회 | `PasskeyVault.refresh` 또는 `applySession` → `GET /api/passkeys/private` | `handler.ts`의 `private` 분기(406행), `requireLockedSession`. 세션에서 얻은 계정 ID로 조회. 항목별 조회는 `id`와 `account_id`를 함께 검사 |

코드 위치의 기준은 이 문서를 작성한 시점이며, 수정 후 행 번호가 바뀌어도 표에 적힌 함수·분기 이름으로 찾을 수 있다. Vercel 진입점은 [api/passkeys/[...path].ts](../api/passkeys/[...path].ts)이며, 개별 자료 및 패스키 삭제는 [private/[id].ts](../api/passkeys/private/[id].ts), [credentials/[id].ts](../api/passkeys/credentials/[id].ts)를 거친다. 로컬 개발은 [vite.config.ts](../vite.config.ts), 빌드 후 로컬 실행은 [server/index.ts](../server/index.ts)에서 동일한 handler를 사용한다.

인증과 권한을 판정하는 중요한 위치는 다음과 같다.

- [handler.ts](../server/passkeys/handler.ts)의 `requestContext`(78행): 변경 요청의 Origin과 전용 요청 헤더를 확인한다.
- `consumeChallenge`(190행): 만료 전 challenge를 `DELETE … RETURNING`으로 한 번만 가져온다. 서명 검증 트랜잭션 밖에서 소비하므로, 검증 실패나 이후 DB 롤백으로 사용한 challenge가 살아나지 않는다.
- `readSession`(156행), `requireLockedSession`(167행): 만료되지 않은 DB 세션과 실제 존재하는 credential을 확인한다. 계정 행을 잠근 후 세션을 다시 확인한다.
- `issueSession`(176행): 로그인 또는 등록 성공 때 32바이트 난수 세션을 새로 발급하고, 같은 요청의 이전 세션은 폐기한다.
- `private` 분기(406행): 요청 쿼리·본문의 계정 ID는 권한 판단에 쓰지 않는다. 개별 조회는 `WHERE id=$1 AND account_id=$2`를 사용한다. 다른 계정 자료는 `403`이다.
- `credentials/` 삭제 분기(433행): 현재 계정의 credential만 삭제한다. 삭제된 credential에서 발급한 세션은 외래키의 `ON DELETE CASCADE`로 함께 사라진다.

challenge는 5분, 로그인 세션은 30분 동안 유효하다. 브라우저는 `passkey_session` 쿠키를 보내고 서버는 그 값의 해시로 DB 세션을 찾는다. 배포 환경 쿠키에는 `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/passkeys`를 설정한다. 세션 원문을 DB에 저장하거나 브라우저 저장소에 기록하지 않는다.

계정당 패스키를 최대 10개까지 추가할 수 있다. 현재 로그인에 사용한 패스키를 삭제하면 해당 세션도 폐기되어 로그아웃된다. 마지막 패스키를 삭제하면 계정과 합성 자료도 DB에서 삭제한다. 패스키를 모두 잃었거나 마지막 패스키를 삭제한 경우, 이 데모에는 복구 수단이 없다. 새 계정을 만들 수 있지만 이전 기록은 이어지지 않는다. 이 결과는 등록 영역과 삭제 확인 창에도 안내한다.

## ④ 안 열리는 것을 확인한 기록

검증 대상은 배포된 Vercel API와 Neon DB다. [scripts/passkeys-smoke.ts](../scripts/passkeys-smoke.ts)가 임시 테스트 계정 A·B와 실제 P-256 서명을 생성해 HTTP 요청 36개를 보냈다. API에 테스트 우회 경로를 만들지 않았고 운영 handler의 공개키·서명 검증을 그대로 통과시켰다. 테스트 인증기는 사용자의 실기기 저장소 또는 사용자 확인 UI를 검증하지 않는다.

아래 요청·응답은 실제 기록을 요약했다. 같은 이름의 `label`을 [deployed-api.json](evidence/deployed-api.json)에서 찾으면 요청 본문과 응답 본문을 확인할 수 있다. 쿠키 원문과 `Set-Cookie`는 `[REDACTED]`로 가렸다.

### 성공·거절을 나란히 비교한 네 가지 확인

| 확인 | 성공한 요청과 응답 | 거절된 요청과 응답 |
| --- | --- | --- |
| 로그인 없이 자료 열기 | A의 유효한 세션으로 `GET /api/passkeys/private` → `200`, A의 자료 3개 (`A 자기 자료`) | 쿠키 없이 동일 경로 요청 → `401`, `패스키로 로그인해 주세요.` (`비로그인 자료 요청`) |
| 남의 계정 자료 열기 | B의 세션으로 `GET /api/passkeys/private` → `200`, B의 자료 3개 (`B 자기 자료`) | A의 세션으로 `GET /api/passkeys/private/1607769a-6680-4d99-9a1d-9a0176e9fcc2` → `403` (`A에서 B 자료 접근 거절`). 반대로 B가 A의 항목 `f71504d8-2518-4bbf-ad55-eb20124469c0`을 요청해도 `403` |
| 이미 쓴 challenge 재사용 | 새 challenge에 대해 정상 서명한 `POST /api/passkeys/login-verify` → `200` (`정상 서명 로그인`) | 같은 요청 본문과 원래 challenge 쿠키로 다시 전송 → `401`, `이미 사용했거나 만료된 인증 요청입니다. 다시 시작해 주세요.` (`사용된 challenge 재사용 거절`) |
| 패스키 삭제 뒤 로그인 | A의 첫 번째 패스키가 유효할 때 로그인 → `200`; 첫 번째 키 삭제 후 남은 두 번째 키로 로그인 → `200` (`삭제 뒤 남은 키 로그인 성공`) | 삭제된 첫 번째 키로 새 challenge에 서명해 로그인 요청 → `401` (`삭제한 키 로그인 거절`) |

‘남의 패스키로 열기’는 A의 패스키가 B로 로그인하게 만드는 시험이 아니다. A의 패스키로 A 세션을 받은 후 B의 자료 ID를 요청하고 서버가 소유권을 거절하는지 확인했다. 반대 방향도 동일하게 확인했다.

교차 요청 전후 자료 건수는 A가 `3 → 3`, B가 `3 → 3`으로 같았다. 주소의 `accountId=B`와 POST 본문의 `{"accountId":"B의 ID"}`를 A 세션과 보내도 `200` 응답에는 A의 계정과 A의 자료만 들어 있었다. 실제 계정 ID와 전체 응답은 각각 `쿼리 계정 위조 무시`, `본문 계정 위조 무시` 기록에 남겼다.

### 매번 다른 challenge

동일한 등록 흐름을 두 번 시작해 받은 값은 다음과 같이 서로 달랐다.

```text
등록 요청 1: idA3MCIXq6pZuF7M363iv8EFNHwTHtQRyzgm9iHwSDo
등록 요청 2: SP2_2ARFwGPLWLH3EKHB9iCxEvZ1MKdU0q8VwR34hmA
```

로그인 요청도 새로운 값을 발급받았다.

```text
정상 서명 로그인 challenge: vH3Zakbsnx7YPrY7T4xHds9UA5Ml2Jp3nN4nd-CHcWg
잘못된 서명 거절 challenge: ysKwM8yiyce5cZd912x2sKLj40phhUXfLq2UIZVHzh8
```

이 값은 이미 사용되었거나 만료된 테스트 challenge이며 로그인 세션 토큰이 아니다. challenge를 가리킨 쿠키 토큰은 공개하지 않는다.

### 서버 공개키와 등록 요청 본문

테스트 A의 첫 번째 키를 등록한 뒤 실제 Neon의 `passkey_credentials.public_key`를 읽었다. 아래는 BYTEA로 저장한 COSE P-256 공개키를 base64url로 표현한 값이다.

```text
pQECAyYgASFYIIYf4OOFSYgSbM3bX2Yjko07nsT885ylTHXWqdAhgCW-Ilgg9zhiYHkzotSBvc5rkaDKnMIEleMHnc-9gBmheYrwVD4
```

인증기가 생성한 공개키와 DB에서 읽은 공개키가 일치했다(`matchesAuthenticatorPublicKey: true`). 이는 서명을 검증하는 공개키이며 비밀번호가 아니다. 공개키만으로 개인키를 대신해 로그인 서명을 만들 수 없다. 해당 테스트 credential과 계정은 이후 삭제했다.

등록 검증의 실제 요청 본문은 다음과 같다. 원문은 증거 파일의 `테스트 A · 첫 번째 키 등록 검증`에도 있다.

```json
{
  "response": {
    "id": "p1AqosNAzbvhcH5ozGx_CdxtvOPMbLnlvkrfVPuHGnU",
    "rawId": "p1AqosNAzbvhcH5ozGx_CdxtvOPMbLnlvkrfVPuHGnU",
    "type": "public-key",
    "clientExtensionResults": { "credProps": { "rk": true } },
    "authenticatorAttachment": "platform",
    "response": {
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoibC1za21fQVZJcnNwUlZDRTY3S2JJX3IycW5SQVJiSlByMTFNT2Vad1JtWSIsIm9yaWdpbiI6Imh0dHBzOi8vbXktd2VicGFnZS1wYXNza2V5cy52ZXJjZWwuYXBwIiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ",
      "attestationObject": "o2NmbXRkbm9uZWhhdXRoRGF0YVikb5k92OBJZfrNl-XlKR1uRsMslFdnDKkCXNt4vkhqjllFAAAAAAAAAAAAAAAAAAAAAAAAAAAAIKdQKqLDQM274XB-aMxsfwncbbzjzGy55b5K31T7hxp1pQECAyYgASFYIIYf4OOFSYgSbM3bX2Yjko07nsT885ylTHXWqdAhgCW-Ilgg9zhiYHkzotSBvc5rkaDKnMIEleMHnc-9gBmheYrwVD5nYXR0U3RtdKA",
      "transports": ["internal"]
    }
  }
}
```

`clientDataJSON`에는 요청 종류·challenge·Origin이, `attestationObject`에는 인증기 데이터와 공개키가 담긴다. 개인키 필드는 없으며 [test-authenticator.ts](../server/passkeys/test-authenticator.ts)는 개인키를 내부 클로저에만 보관한다. 이 실제 요청은 소프트웨어 인증기의 기록이다. 위 요청의 `platform`·`internal` 표시는 테스트 데이터의 값이며 실기기나 저장 제공자를 확인한 증거로 해석하지 않는다.

### 서명 실패, 로그아웃, 취소

| 항목 | 성공 기록 | 거절 또는 취소 기록 |
| --- | --- | --- |
| 서명 검증 | `정상 서명 로그인`: 새 challenge와 올바른 서명 → `200` | `잘못된 서명 거절`: 새 challenge의 서명 1바이트를 변경 → `401` |
| 로그아웃한 세션 재사용 | 로그아웃 전 `A 자기 자료` → `200`; `POST /logout` → `200` | 이전과 **동일한** 세션 쿠키로 `/private` 재요청 → `401` (`로그아웃 세션 재사용 거절`). 공개 기록에서는 값만 `[REDACTED]` |
| 마지막 키 삭제 | `DELETE /credentials/{마지막 키 ID}` → `200`, `authenticated: false` | 삭제 직전 세션을 재사용한 `/private` → `401` (`마지막 키 삭제 후 세션 거절`) |
| 등록 취소 | 서로 다른 등록 challenge 2회 발급 → 각각 `200` | `POST /cancel` → `200`. 로컬 DB 검증에서 발급한 challenge가 삭제되고, 계정·credential·자료는 생성되지 않았음을 확인 |

등록 취소는 아직 브라우저의 실제 인증 창에서 수동 확인하지 않았다. API 취소 검증과 화면의 취소 안내 구현을 확인한 상태다. 인증 시도 제한용 카운터는 남을 수 있지만, 취소만으로 계정·패스키·비공개 자료를 저장하지 않는다.

로컬 [handler.test.ts](../server/passkeys/handler.test.ts)의 20개 테스트도 통과했다. challenge 병행 재사용, 등록 중 세션 폐기, 삭제와 로그인 병행, 계정 위조, 잘못된 RP ID·Origin·사용자 핸들·사용자 확인 플래그·서명 카운터 등을 포함한다. PGlite의 트랜잭션 실행은 실제 Neon의 다중 연결과 동일한 부하 시험은 아니므로, 동시성 검증 범위를 무제한 운영 보장으로 해석하지 않는다.

## ⑤ AI와 나

### AI에게 맡긴 일

AI는 명세 분석, 별도 프로젝트 구성, 익명 공개 소개 작성, 패스키 화면과 서버 구현, Neon 연결·DB 스키마 적용, 배포, 자동 테스트와 요청·응답 기록, 코드 검토 및 문서 초안 작성을 담당했다.

### 내가 직접 판단한 일

제출자는 Neon PostgreSQL 사용, 고정 도메인 사용, 실제 패스키 인증의 사용자 직접 승인을 결정했다. 특히 공개 제출본에는 익명·합성 자료를 사용하고 기존 개인 사이트와 비공개 저장소를 유지하기로 선택했다. 이 선택에 따라 별도 공개 저장소와 배포를 구성했다. 실제 인증기 승인과 선택한 저장 위치 확인은 제출자가 직접 수행해야 한다.

### AI 제안을 따르지 않은 일

초기 방향의 기존 저장소 공개 및 기존 소개 내용 유지 대신, 개인정보가 포함된 기존 서비스는 유지하고 별도 합성 제출본을 만들기로 바꾸었다. 개인정보를 공개 코드에 포함하지 않기 위한 제출자의 판단이다. 그 결과 T08-C12를 위한 익명화는 반영했지만, T08-C11의 ‘1번 과제 공개 내용이 그대로 남아 있다’는 문구는 그대로 충족하지 않는다. 이를 통과로 꾸미지 않고 제출 평가 시 확인이 필요한 예외로 명시한다.

## ⑥ 아직 못 막은 것

- **세션 탈취 이후 패스키 추가:** 이미 유효한 세션을 가진 요청은 기존 패스키로 재인증하지 않고 새 패스키를 등록할 수 있다. 세션이 탈취되면 공격자가 자기 키를 추가해 접근을 유지할 가능성이 있다. 추가·삭제 전에 기존 패스키의 최근 인증을 요구하는 기능은 구현하지 않았다.
- **다른 탭의 이미 표시된 자료:** 다른 탭에서 로그아웃하거나 키를 삭제해도 현재 탭의 화면이 즉시 통지받지는 않는다. 포커스·표시 상태 변경 또는 최대 60초 주기 재확인으로 닫는다. 서버는 폐기된 세션의 다음 자료 요청을 거부하지만, 이미 내려받아 표시한 내용을 회수할 수는 없다.
- **패스키를 모두 잃은 경우:** 이메일·관리자 복구 등 별도 복구 수단이 없다. 특히 마지막 키 삭제는 계정과 합성 자료 삭제까지 수행한다. 화면에서 안내하지만 복구를 제공하지 않는다.
- **실기기 저장소와 사용자 승인:** 실제 Windows·Apple·Google·보안 키 등록 및 다른 기기 전환을 아직 확인하지 않았다. 소프트웨어 인증기의 사용자 확인 플래그 검증은 실제 지문·얼굴·PIN 승인 동작을 대신하지 못한다.
- **대규모 악용과 부하:** 인증 API에 요청량 제한과 본문 크기 제한을 적용했지만 분산 공격, 장기간 계정 대량 생성, 대규모 동시 부하까지 검증하지 않았다.

실기기 단계, 제출 항목별 판정과 짧은 확인 방법은 [SUBMISSION.md](SUBMISSION.md)에 정리했다.
