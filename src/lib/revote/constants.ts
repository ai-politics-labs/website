// 선거권 회복 100만 서명운동 (revote) 공유 상수
// aiparty.kr 와 동일한 Supabase 프로젝트를 재사용합니다.

export const SUPABASE_URL = "https://bsiatqjivenmblkcujjw.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzaWF0cWppdmVubWJsa2N1amp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODk2OTMsImV4cCI6MjA4ODM2NTY5M30.ReRm1mteN7bsWiRoMhHc8EfhLncJuLZ_8hSR-El8-S4";

export const SUPABASE_ESM = "https://esm.sh/@supabase/supabase-js@2";

// Storage
export const EVIDENCE_BUCKET = "revote-evidence";

// 캠페인 목표 — 1만에서 시작, 달성 시 10만→20만→…→100만 자동 상향
export const SIGNATURE_MILESTONES = [
  10_000, 100_000, 200_000, 300_000, 400_000, 500_000,
  600_000, 700_000, 800_000, 900_000, 1_000_000,
];
export const SIGNATURE_GOAL = SIGNATURE_MILESTONES[0];

// 동의서 버전 (변경 시 consent_logs 에 반영됨)
export const CONSENT_VERSION = "2026-06-06";

// 파일 업로드 정책
export const ALLOWED_FILE_EXT = ["jpg", "jpeg", "png", "heic", "pdf", "mp4", "mov", "txt"];
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_FILES_PER_REPORT = 10;

// 카카오 공유 (실제 키로 교체하세요. 미설정 시 링크복사로 폴백)
export const KAKAO_JS_KEY = ""; // TODO: 카카오 JavaScript 앱 키

// 사이트 기본 경로 / URL
export const BASE_PATH = "/revote";
export const SITE_URL = "https://aiparty.kr/revote";

// 공유 카피
export const SHARE_TITLE = "선거권 회복 100만 서명운동";
export const SHARE_DESC =
  "투표용지가 부족했고, 일부 시민은 투표를 포기했습니다. 선거권 회복을 위한 100만 서명에 함께해주세요.";

// 메인 선언문 (랜딩 Hero)
export const HERO_LINES = [
  "투표용지가 부족했고,",
  "시민은 투표를 포기했습니다.",
];

// 요구사항 3개 — mark 는 노란 하이라이트로 강조할 키워드
export const DEMANDS = [
  { text: "유책 선관위직원 전원 해임 및 채용비리 없는 재선발", mark: "재선발" },
  { text: "서울·인천·부산 등 피해 확인 지역 재선거", mark: "재선거" },
  { text: "독립적인 진상조사 및 재발방지", mark: "재발방지" },
];

// 연락처
export const CONTACT_EMAIL = "revote@aiparty.kr"; // TODO: 실제 운영 이메일로 교체

// 법률대응 수임 변호사 (위임장)
export const LAWYER = {
  name: "박세준",
  firm: "법무법인(유한) 한별",
  office: "Seoul Office",
  email: "sejunbak@hanbl.co.kr",
  phone: "02-6255-7779",
};

// 위임장 — 피해 유형
export const DAMAGE_TYPES = [
  "투표용지 부족",
  "투표 지연",
  "투표 포기",
  "기타",
];

// 위임장 — 특별수권사항 (선택)
export const SPECIAL_AUTHORITIES = [
  "소청·심판청구 또는 소의 취하",
  "청구의 포기 또는 인낙",
  "화해 또는 조정 합의",
  "상소·항고의 제기 또는 취하",
  "복대리인 또는 공동대리인의 선임",
  "별도 비용이 발생하는 절차의 진행",
];

// 위임장 — 동의사항 (1~4 필수, 5 확인)
export const DELEGATION_CONSENTS = [
  {
    key: "purpose",
    required: true,
    text: "본인은 선거권 회복 100만 서명운동의 취지에 동의하고 참여합니다.",
  },
  {
    key: "submission",
    required: true,
    text: "본인은 본 문서 및 관련 제보자료가 법률 검토, 소청·소송·헌법소원·국가배상청구·정보공개청구 등 절차 수행을 위하여 수임인, 공동대리인, 법원, 헌법재판소, 선거관리위원회 및 관계기관에 제출될 수 있음에 동의합니다.",
  },
  {
    key: "privacy",
    required: true,
    text: "본인은 이름, 연락처, 주소, 생년월일, 제보내용, 첨부자료 등 개인정보 및 민감정보를 위 목적 범위 내에서 수집·이용하는 것에 동의합니다.",
  },
  {
    key: "third_party",
    required: true,
    text: "본인은 필요한 범위에서 수임인, 법무법인, 공동대리인 또는 업무수탁자에게 제3자 제공되는 것에 동의합니다.",
  },
  {
    key: "disclosure_notice",
    required: true,
    text: "본인은 언론 또는 대외 공개는 별도 동의가 있는 경우에만 진행됨을 확인합니다.",
  },
];
