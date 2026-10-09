// 선거권 회복 100만 서명운동 — 공유 브라우저 클라이언트 (정적 ESM 모듈)
// 모든 /revote 페이지가 `import { ... } from '/revote/revote-client.js'` 로 사용.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// aiparty.kr 와 동일 Supabase 프로젝트
export const SUPABASE_URL = "https://bsiatqjivenmblkcujjw.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzaWF0cWppdmVubWJsa2N1amp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODk2OTMsImV4cCI6MjA4ODM2NTY5M30.ReRm1mteN7bsWiRoMhHc8EfhLncJuLZ_8hSR-El8-S4";

export const EVIDENCE_BUCKET = "revote-evidence";
// 목표 단계: 1만 달성 시 10만, 이후 10만 단위로 100만까지 자동 상향
export const SIGNATURE_MILESTONES = [
  10_000, 100_000, 200_000, 300_000, 400_000, 500_000,
  600_000, 700_000, 800_000, 900_000, 1_000_000,
];
export const SIGNATURE_GOAL = SIGNATURE_MILESTONES[0];

// 현재 집계(total)에 맞는 목표치(다음 단계) 계산. 100만 도달 후에는 100만 고정.
export function goalForTotal(total) {
  const n = Number(total || 0);
  for (const m of SIGNATURE_MILESTONES) {
    if (n < m) return m;
  }
  return SIGNATURE_MILESTONES[SIGNATURE_MILESTONES.length - 1];
}
// 표시용 기준 카운트 (오프라인/사전 모집분 등 실집계에 더해 노출)
export const BASE_COUNT = 1534;
export const CONSENT_VERSION = "2026-06-06";
export const SITE_URL = "https://aiparty.kr/revote";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── 휴대폰 번호 정규화 + SHA-256 해시 (중복확인용) ─────────────────────────
export function normalizePhone(raw) {
  let v = String(raw || "").replace(/[^0-9+]/g, "");
  if (v.startsWith("+82")) v = "0" + v.slice(3);
  else if (v.startsWith("82")) v = "0" + v.slice(2);
  return v.replace(/[^0-9]/g, "");
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function phoneHash(raw) {
  return sha256Hex("revote:" + normalizePhone(raw));
}

// ── 휴대폰 입력 자동 포맷 (aiparty 폼과 동일 동작) ────────────────────────
export function formatMobile(raw) {
  let v = normalizePhone(raw);
  if (v.length > 11) v = v.slice(0, 11);
  if (v.length >= 8) return v.slice(0, 3) + "-" + v.slice(3, v.length - 4) + "-" + v.slice(v.length - 4);
  if (v.length >= 4) return v.slice(0, 3) + "-" + v.slice(3);
  return v;
}

export function isValidMobile(raw) {
  return /^01[016789]\d{7,8}$/.test(normalizePhone(raw));
}

// ── 숫자 천단위 콤마 ──────────────────────────────────────────────────────
export function formatNumber(n) {
  return Number(n || 0).toLocaleString("ko-KR");
}

// ── 카운터 조회 (집계 RPC) ────────────────────────────────────────────────
export async function fetchSignatureCount() {
  const { data, error } = await supabase.rpc("revote_signature_count");
  if (error || !data) return { total: BASE_COUNT, today: 0, goal: SIGNATURE_GOAL };
  return { ...data, total: (data.total || 0) + BASE_COUNT };
}

// ── 공개 의견 목록 (마스킹된 이름 + 멘트) ─────────────────────────────────
export async function fetchRecentComments(limit = 20) {
  const { data, error } = await supabase.rpc("revote_recent_comments", { p_limit: limit });
  if (error || !data) return { total: 0, items: [] };
  return { total: data.total || 0, items: data.items || [] };
}

// ── 추천(referral) 처리 ───────────────────────────────────────────────────
export function getRefFromUrl() {
  const p = new URLSearchParams(location.search);
  return p.get("ref");
}

export function getVisitorId() {
  let id = localStorage.getItem("revote_vid");
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(36).slice(2);
    localStorage.setItem("revote_vid", id);
  }
  return id;
}

// 추천 링크 방문 기록 (랜딩 진입 시 1회). 들어온 ref 는 세션에 저장해 전환에 사용.
export async function trackReferralVisit() {
  const ref = getRefFromUrl();
  if (!ref) return null;
  sessionStorage.setItem("revote_ref", ref);
  const channel = new URLSearchParams(location.search).get("ch") || "link";
  try {
    await supabase.from("revote_referrals").insert({
      referral_code: ref,
      visitor_id: getVisitorId(),
      channel,
    });
  } catch (_) {}
  track("referral_visit", { referral_code: ref, channel });
  return ref;
}

export function getStoredRef() {
  return sessionStorage.getItem("revote_ref") || getRefFromUrl();
}

// 전환 연결 (서명 완료 후 호출)
export async function linkReferralConversion(signatureId, channel) {
  const ref = getStoredRef();
  if (!ref) return;
  try {
    await supabase.rpc("revote_link_referral", {
      p_code: ref,
      p_signature_id: signatureId,
      p_channel: channel || "link",
    });
  } catch (_) {}
  track("referral_conversion", { referral_code: ref, channel: channel || "link" });
}

// ── 분석 이벤트 (PRD 15.1). GA4/PostHog 연동 전까지 dataLayer/console 폴백 ──
export function track(event, params = {}) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...params });
    if (window.gtag) window.gtag("event", event, params);
  } catch (_) {}
}

// ── 동의 로그 저장 ────────────────────────────────────────────────────────
export async function logConsents(subjectType, subjectId, consents) {
  // consents: [{ type, consented }]
  const rows = consents.map((c) => ({
    subject_type: subjectType,
    subject_id: subjectId,
    consent_type: c.type,
    consent_version: CONSENT_VERSION,
    consented: !!c.consented,
    user_agent: navigator.userAgent,
  }));
  try {
    await supabase.from("revote_consent_logs").insert(rows);
  } catch (_) {}
}

// ── 링크 복사 ─────────────────────────────────────────────────────────────
export async function copyShareLink(referralCode) {
  const url = SITE_URL + (referralCode ? `/?ref=${referralCode}&ch=link` : "/");
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch (_) {
    return false;
  }
}
