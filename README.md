# My Webpage · Passkeys

공개 자기소개 페이지와 패스키로 여는 개인 기록함을 제공하는 웹 애플리케이션입니다. 공개 소개는 작성자가 공개 범위를 선별한 실제 자기소개이며, 패스키 계정과 비공개 기록은 인증 기능 검증을 위해 만든 합성 데이터입니다.

- 웹사이트: https://my-webpage-passkeys.vercel.app/
- 소스: https://github.com/hyeseong-dev/My-Webpage-Passkeys

## 기능

- 로그인 없이 열리는 실제 자기소개와 세 가지 이야기
- WebAuthn 패스키로 데모 계정 생성 및 로그인
- 로그인한 계정에만 제공하는 세 가지 비공개 기록
- 한 계정에 여러 패스키 등록, 이름과 등록일 확인, 패스키 삭제
- 서버 세션을 폐기하는 로그아웃과 30분 세션 만료
- 좁은 화면, 키보드 이동 및 모션 줄이기 지원

패스키의 개인키는 선택한 기기 또는 비밀번호 관리자에서 관리됩니다. 서버에는 검증에 필요한 공개키를 저장합니다. 모든 패스키를 잃으면 기존 계정을 복구할 수 없습니다. 마지막 패스키를 삭제하면 해당 데모 계정과 기록도 삭제됩니다.

## 기술 구성

React · TypeScript · Vite · SimpleWebAuthn · PostgreSQL(Neon) · Vercel Functions

## 설치와 실행

Node.js 22.12 이상과 pnpm 10이 필요합니다.

```sh
git clone https://github.com/hyeseong-dev/My-Webpage-Passkeys.git
cd My-Webpage-Passkeys
pnpm install --frozen-lockfile
```

`.env.example`을 참고해 `.env.local`을 만들고 PostgreSQL 연결 주소를 입력합니다. 서버 전용 값에 `VITE_` 접두사를 붙이지 마세요.

```sh
pnpm db:migrate
pnpm dev
```

http://localhost:4173/ 에서 실행됩니다. 로컬에서도 실제 패스키가 필요하며, 로컬에 등록한 패스키와 배포 도메인에 등록한 패스키는 서로 다릅니다. 다른 개발 서버가 4173 포트를 사용 중이라면 먼저 종료하거나 개발 포트와 `PASSKEY_DEV_ORIGINS`를 함께 변경하세요.

## 환경변수

| 이름 | 설명 |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL 연결 주소. 서버에서만 사용합니다. |
| `PASSKEY_ORIGIN` | 운영 Origin. 기본 `https://my-webpage-passkeys.vercel.app` |
| `PASSKEY_RP_ID` | 패스키 도메인. 기본 `my-webpage-passkeys.vercel.app` |
| `PASSKEY_DEV_ORIGINS` | 개발 환경에서 허용할 HTTP/HTTPS loopback Origin 목록 |
| `PORT` | Express 서버 포트. 기본 `3000` |

배포 시 Vercel 프로젝트에 `DATABASE_URL`을 연결하고 데이터베이스 준비 명령을 한 번 실행합니다. 이후 다음 명령으로 빌드할 수 있습니다.

```sh
pnpm build
pnpm start
```

운영 패스키는 HTTPS 정식 도메인에서 사용합니다. 개별 Preview 주소에서는 정식 홈페이지로 안내합니다. 로컬 개발은 `pnpm dev`로 실행하세요.

## 프로젝트 구조

```text
client/src/pages/Home.tsx          공개 소개
client/src/components/PasskeyVault.tsx  패스키와 비공개 기록 화면
server/passkeys/                  인증·세션·자료 접근 처리
server/passkeys/schema.sql         PostgreSQL 테이블 정의
api/passkeys/                     Vercel 서버 함수
scripts/passkeys-migrate.mjs       데이터베이스 준비
docs/                             인증 구현 설명 및 실습 기록
```

## License

MIT
