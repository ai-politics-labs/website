// ── 분석 로더 (GA4 / PostHog) ────────────────────────────────────────────────
// 키 미설정 시 완전 no-op. window.dataLayer 는 항상 정의되므로
// revote-client.js track() 의 dataLayer.push() 는 항상 안전하게 동작.
//
// PRD 15.1 추적 이벤트 목록:
//   page_view_home             — 랜딩 페이지 조회
//   click_sign_cta             — 서명 버튼 클릭
//   start_signature            — 서명 폼 진입
//   submit_signature_success   — 서명 성공
//   submit_signature_duplicate — 중복 서명
//   click_report_cta           — 제보 버튼 클릭
//   start_report               — 제보 폼 진입
//   upload_file_success        — 파일 업로드 성공
//   submit_report_success      — 제보 성공
//   share_kakao_click          — 카카오 공유 클릭
//   copy_link_click            — 링크 복사 클릭
//   referral_visit             — 추천 링크 유입
//   referral_conversion        — 추천 링크 서명 전환
//
// 설정 방법: 아래 상수에 실제 키 값을 입력하세요.
// TODO: GA4 측정 ID (예: "G-XXXXXXXXXX")
const GA_MEASUREMENT_ID = "";
// TODO: PostHog 프로젝트 API 키 (예: "phc_XXXXXXXXXXXX")
const POSTHOG_KEY = "";

(function () {
  "use strict";

  // dataLayer 는 키 미설정 시에도 항상 정의
  window.dataLayer = window.dataLayer || [];

  // ── GA4 ──────────────────────────────────────────────────────────────────
  if (GA_MEASUREMENT_ID) {
    try {
      // gtag 헬퍼 (GA4 스크립트 로드 전에 미리 정의해야 큐잉이 동작함)
      function gtag() {
        window.dataLayer.push(arguments);
      }
      window.gtag = gtag;

      gtag("js", new Date());
      gtag("config", GA_MEASUREMENT_ID);

      // GA4 스크립트 동적 삽입
      var s = document.createElement("script");
      s.async = true;
      s.src =
        "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
      s.onerror = function () {
        // 로드 실패 시 window.gtag 를 no-op 으로 유지 (이미 dataLayer 큐는 살아 있음)
      };
      document.head.appendChild(s);
    } catch (_) {}
  }

  // ── PostHog ──────────────────────────────────────────────────────────────
  if (POSTHOG_KEY) {
    try {
      // PostHog 스니펫 (CDN)
      !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(a!==void 0?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return a!=="posthog"&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

      window.posthog.init(POSTHOG_KEY, {
        api_host: "https://app.posthog.com",
        capture_pageview: true,
        persistence: "localStorage",
      });

      // ── GA4 ↔ PostHog 브리지 ─────────────────────────────────────────────
      // revote-client.js track() 은 window.gtag 를 직접 호출하므로,
      // GA 키가 없어도 PostHog 로 이벤트를 포워딩하는 capture 래퍼를 추가.
      // window.revoteCapture(event, params) — 양쪽 모두 수신하는 단일 진입점.
      window.revoteCapture = function (event, params) {
        try {
          if (window.posthog && window.posthog.capture) {
            window.posthog.capture(event, params || {});
          }
          if (window.gtag) {
            window.gtag("event", event, params || {});
          }
        } catch (_) {}
      };

      // GA 없이 PostHog 만 쓸 때를 위해 gtag 도 posthog.capture 로 폴백 래핑
      if (!GA_MEASUREMENT_ID) {
        window.gtag = function (type, event, params) {
          try {
            if (type === "event" && window.posthog && window.posthog.capture) {
              window.posthog.capture(event, params || {});
            }
          } catch (_) {}
        };
      }
    } catch (_) {}
  }
})();
