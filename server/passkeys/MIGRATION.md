# 패스키 저장소 준비

Node.js 22.12 이상과 PostgreSQL(Neon)을 사용합니다. 서버 환경에 `DATABASE_URL`을 설정한 뒤 프로젝트 루트에서 한 번 실행합니다.

```sh
node --env-file=.env.local scripts/passkeys-migrate.mjs
```

배포 환경에서 `DATABASE_URL`을 이미 제공한다면 `--env-file=.env.local`을 생략합니다. 연결 문자열은 저장소나 제출 기록에 넣지 않습니다. 외부 서버의 `sslmode=require`, `prefer`, `verify-ca`는 인증서와 호스트를 검증하는 `verify-full`로 정규화합니다.

마이그레이션은 트랜잭션과 PostgreSQL advisory lock 안에서 누락된 테이블과 인덱스를 생성합니다. 다시 실행해도 기존 계정과 패스키는 유지됩니다. API는 자동으로 스키마를 만들지 않으며, 저장소가 준비되지 않았을 때 503으로 닫힙니다.

기준 주소는 `PASSKEY_ORIGIN=https://my-webpage-passkeys.vercel.app`, RP ID는 `PASSKEY_RP_ID=my-webpage-passkeys.vercel.app`입니다. 서버의 기본값도 같습니다. 운영 모드에서는 로컬 주소를 허용하지 않습니다. 개발 모드의 `localhost:4173`과 `127.0.0.1:4173`에서도 실제 패스키 인증이 필요합니다.

계정과 세 개의 가상 자료는 등록 검증에 성공한 뒤에만 함께 저장됩니다. 마지막 패스키를 삭제하면 해당 계정과 가상 자료도 제거되며 복구 경로가 없습니다.

`test-authenticator.ts`와 `test-harness.ts`는 P-256 서명을 생성하는 소프트웨어 인증기와 격리된 PGlite 저장소입니다. 실제 인증 라이브러리 검증을 거치지만 Windows Hello·Touch ID 승인이나 Neon 다중 연결의 동시 실행을 대신하는 증거는 아닙니다. 운영 API는 이 파일들을 가져오지 않습니다.
