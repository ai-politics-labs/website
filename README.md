# AIP · AI Party

연구자와 창업가가 제대로 대우받는 나라를 위한 창당 사이트입니다.

https://aiparty.kr

## 현재 사이트 구조

| 경로 | 내용 |
| --- | --- |
| `/` | 소개, 공개 동의 발기인 카드, 발기인 동의·가입 |
| `/auth` | 로그인, 이메일 인증, 비밀번호 찾기 |
| `/account` | 초대 링크, 추천 현황, 계정 삭제 요청 |
| `/dashboard` | 전체 발기인 수, 지역별 집계 |
| `/community/privacy` | 계정·추천 정보 안내 |
| `/admin` | 발기인 운영자 화면 |

선언문·ATLAS2049·Vault·선거권 회복 캠페인 화면은 사이트에서 제거했습니다. 원본은 `archive/retired-sections-2026-10-09/`에 보관하며 빌드·배포·스타일 검색 대상에서 제외합니다. 기존 Supabase 접수 데이터와 SQL 이력은 보존합니다.

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

## 발기인 대시보드 (`/dashboard`)

메인 사이트 상단의 **발기인 현황**에서 전체 온라인 동의서 접수 수와 시·도별 인원·비율을 확인합니다. 화면 진입과 새로고침 시 최신 집계를 읽습니다. 개인정보 대신 집계 전용 RPC만 사용합니다.

배포 전 Supabase SQL Editor에서 `db/2026-10-09_founding_member_stats.sql`을 실행하세요. 기존 `public.founding_members` 테이블이 필요하며, 기존 접수 데이터와 조회 정책은 변경하지 않습니다. 집계 함수가 없거나 요청에 실패하면 0명으로 표시하지 않고 연결 오류를 안내합니다.

검증: `node --experimental-strip-types --test tests/founding-stats.test.mjs`, `npm run build`. PostgreSQL 회귀 검증은 임시 테스트 DB에서 `tests/founding-member-stats.sql`을 실행합니다. 이 테스트는 입력 테이블을 만들므로 운영 DB에서 실행하지 마세요.

## 계정·추천 링크

- `/#founding-members`: 발기인 동의서와 로그인용 이메일·아이디·비밀번호를 한 번 제출합니다. 사이트 계정과 발기인 등록은 함께 저장됩니다. 아이디가 추천인 ID입니다.
- `/auth`: 기존 계정 로그인, 이메일 인증 재전송, 비밀번호 찾기. 별도 회원가입 양식은 없으며 가입 링크는 발기인 동의서로 연결됩니다.
- `/account`: 기본 초대 링크, UTM 채널별 링크, 방문 브라우저·인증 완료 가입·추천인 ID 가입 수. 추천받은 회원의 이메일은 제공하지 않습니다.
- `/community/privacy`: 계정·추천 정보 안내 및 계정 삭제 요청 경로.

운영 순서: `db/2026-10-09_founding_member_stats.sql` → `db/2026-10-09_community.sql` → `db/2026-10-09_founding_signup.sql` → **마지막으로** `db/2026-10-09_disable_board.sql`을 DB 소유자로 적용합니다. 앞선 community 파일을 다시 실행하면 가입 트리거와 게시판 권한이 구형으로 돌아가므로 두 후속 파일도 순서대로 다시 적용하세요. 운영자 UUID 하나만 명시적으로 초기 등록하며 새 가입자는 운영자가 되지 않습니다. PostgreSQL15 이상이 필요합니다.

게시판은 현재 운영하지 않습니다. 화면·메뉴·클라이언트 스크립트는 제거하고, 네 개의 게시판 RPC 실행 권한도 차단합니다. 기존 게시글 테이블과 데이터는 복구할 수 있도록 삭제하지 않습니다.

Supabase Auth의 Site URL은 `https://aiparty.kr`, Redirect URL은 `https://aiparty.kr/auth**`로 설정합니다. 이메일 확인을 유지하며 공개 가입의 인증·비밀번호 재설정 이메일에는 별도 SMTP 서비스를 연결해야 합니다.

추천 방문은 브라우저 임의 UUID로 중복을 줄여 측정합니다. 30일 첫 방문 경로는 서버에 보관하고 가입 metadata는 최초 가입 시점에 고정합니다. 직접 입력한 추천인이 우선하며 같은 추천인이라면 채널 연결을 유지합니다. 인증 완료 계정만 전환 수에 포함합니다. 브라우저·다중 계정 조작을 완전히 방지하는 사람 수 측정이 아닙니다. 방문 RPC의 별도 edge rate limit은 아직 없습니다.

신규 동의서는 비공개 임시 저장 후 15분짜리 일회용 토큰으로 Auth 계정과 연결합니다. 비밀번호는 Auth에만 전달하고, 서명·주소·생년월일은 Auth metadata나 브라우저 저장소에 넣지 않습니다. 등록이 완료되면 임시 개인정보는 즉시 지웁니다. 미완료 임시 자료는 만료 후 다음 정상 준비 요청에서 정리되며, 정확히 15분 뒤 삭제되는 스케줄러는 아직 없습니다. 최대 임시 대기 1,000건·이메일당 15분에 10회로 제한합니다. 기존 발기인 111건은 새 계정에 추정 연결하지 않습니다.

디자인은 사용자 지정 Refero Luma site400의 인증 카드·날짜 목록·캘린더 패널을 기준으로 통일하며, AIP 로고 원본은 유지합니다. 세부 기준은 `docs/community-design.md`를 참조하세요.

검증: `node --experimental-strip-types --test tests/*.test.mjs`, `tests/run-community-db.sh`, `tests/run-founding-signup-db.sh`, `tests/run-disable-board-db.sh`, `npm run build`. SQL 회귀 테스트는 운영 DB가 아닌 전용 임시 클러스터에서 실행하세요.

회원 삭제 요청은 `community_admin_deletion_requests()`를 운영자 인증으로 호출해 조회합니다. 자동 삭제는 수행하지 않습니다. 기존 법적 동의서와 캠페인 자료는 별도 보관·삭제 절차를 따릅니다.

공식 API 근거: [Supabase signup](https://supabase.com/docs/reference/javascript/auth-signup), [사용자 프로필·RLS](https://supabase.com/docs/guides/auth/managing-user-data), [이메일·비밀번호 인증](https://supabase.com/docs/guides/auth/passwords).

## 인증 메일

인증·비밀번호 재설정 메일 템플릿은 `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`입니다. Supabase Authentication → Emails → Templates에서 각각 사용합니다. 제목은 ‘AIP 이메일 주소 확인’, ‘AIP 비밀번호 재설정’입니다. `{{ .ConfirmationURL }}`은 Supabase가 생성하는 일회용 링크이므로 하드코딩하거나 로그인 토큰을 직접 넣지 않습니다.

SMTP 비밀번호/API 키는 Supabase의 암호화된 SMTP 설정에만 저장하고 저장소·클라이언트·로그에 넣지 않습니다. 실제 발송은 검증된 발송 도메인과 SMTP 계정 연결 후 확인해야 합니다. 공급자 클릭 추적은 인증 링크가 변형되지 않도록 사용하지 않습니다.

## 공개 동의 발기인 카드

현재는 사용자 요청에 따라 카드·탐색 버튼·공개 인원 표시를 빌드 시 출력하지 않습니다. `src/pages/index.astro`의 `showOrganizerProfiles`는 `false`이며, 얼굴 이미지를 받은 뒤 프로필과 공개 동의를 다시 확인하고 표시합니다. 소개 문구와 보관된 명단은 유지합니다.

홈의 인물 카드는 `src/data/public-founders.json`의 마스킹된 이름과 DB에 등록한 직업을 사용합니다. 2026-10-09 Supabase에서 `public_consent = true`, `privacy_agreed = true`인 발기인 19명을 조회한 현재 명단입니다. 원래 이름·연락처·주소·서명은 이 파일에 저장하지 않습니다. 직업은 사용자의 명시적인 요청에 따라 등록값 그대로 표시합니다. 확인되지 않은 사진·성과·소개 문장도 만들지 않습니다.

갱신할 때는 `db/queries/public-founders-masked.sql`을 실행해 반환된 `profiles` 배열만 교체합니다. 이름은 데이터베이스에서 먼저 가리며, 가린 이름이 같아도 서로 다른 발기인일 수 있어 중복 제거하지 않습니다. 이 명단은 정적 스냅샷이므로 공개 동의 변경·철회 시 다시 조회해 반영해야 합니다. 테이블 조회 권한이나 RLS 정책은 변경하지 않았습니다.
