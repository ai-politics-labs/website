# AI Politics Labs

민주적으로 선출된 최초의 AI 정치인을 만듭니다.

https://aiparty.kr

AI는 얻을 것도, 잃을 것도 없기에 가장 투명하고 바르게 정치합니다. 국민과 당원에게 배운 규칙을 토대로 인간 정치인과 토론하고 정책을 제안하며, 인간을 대리인으로 삼아 26년 6월 지방선거에 출마합니다.

## Development

| Command | Action |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Start dev server at `localhost:4321` |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview build locally |

## Tech Stack

- [Astro](https://astro.build)
- [Tailwind CSS](https://tailwindcss.com)
- [Pretendard](https://github.com/orioncactus/pretendard)

## 선거권 회복 100만 서명운동 (`/revote`) 운영자 설정

`/revote/*` 하위 사이트는 aiparty.kr 와 동일한 Supabase 프로젝트를 사용합니다. 배포 전 아래를 반드시 수행하세요.

1. **DB 스키마 적용** — Supabase 대시보드 → SQL Editor 에서 `db/2026-06-06_revote_schema.sql` 전체를 실행합니다. `revote_` 테이블·RLS·RPC·Storage 버킷(`revote-evidence`, 비공개)이 생성됩니다. 이후 `db/2026-06-06_revote_comments.sql` 도 실행하면 서명 의견(멘트) 컬럼과 공개 의견 목록 RPC(`revote_recent_comments`)가 추가됩니다.
2. **관리자 계정 생성** — Supabase 대시보드 → Authentication → Users 에서 관리자 이메일/비밀번호 계정을 추가합니다. `/revote/admin` 로그인에 사용됩니다. (인증된 사용자는 모두 관리자 권한을 가지므로, 이 프로젝트의 Auth 에는 신뢰된 운영자만 등록하세요.)
3. **연동 키 입력 (선택)** — 미입력 시 해당 기능은 자동으로 비활성화(no-op)됩니다.
   - `public/revote/kakao.js` → `KAKAO_JS_KEY` (카카오 공유)
   - `public/revote/analytics.js` → `GA_MEASUREMENT_ID`, `POSTHOG_KEY` (분석)
