// 선거권 회복 100만 서명운동 (revote) 공유 상수
// aiparty.kr 와 동일한 Supabase 프로젝트를 재사용합니다.

export const SUPABASE_URL = "https://bsiatqjivenmblkcujjw.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzaWF0cWppdmVubWJsa2N1amp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODk2OTMsImV4cCI6MjA4ODM2NTY5M30.ReRm1mteN7bsWiRoMhHc8EfhLncJuLZ_8hSR-El8-S4";

export const SUPABASE_ESM = "https://esm.sh/@supabase/supabase-js@2";

// Storage
export const EVIDENCE_BUCKET = "revote-evidence";

// 캠페인 목표
export const SIGNATURE_GOAL = 1_000_000;

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
  "일부 시민은 투표를 포기했습니다.",
];

// 요구사항 3개
export const DEMANDS = [
  "선관위원장·사무총장·중앙선관위·각 지역선관위 등 유책 공무원 해임 및 공정하고 투명한 재선발",
  "서울·인천·부산 등 피해 확인 지역 재선거",
  "독립적 진상조사 및 재발방지 시스템 마련",
];

// 연락처
export const CONTACT_EMAIL = "revote@aiparty.kr"; // TODO: 실제 운영 이메일로 교체
