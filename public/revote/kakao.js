// 카카오 공유 모듈. KAKAO_JS_KEY 설정 시 카카오 SDK 로 공유, 미설정 시 false 반환(링크복사 폴백).
const KAKAO_JS_KEY = ""; // TODO: 카카오 JavaScript 앱 키 입력

let loader = null;
function loadSdk() {
  if (!KAKAO_JS_KEY) return Promise.resolve(null);
  if (window.Kakao && window.Kakao.isInitialized && window.Kakao.isInitialized()) {
    return Promise.resolve(window.Kakao);
  }
  if (loader) return loader;
  loader = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js";
    s.integrity = "sha384-TiCUE00h649CAMonG018J2ujOgDKW/kVWlChEuu4jK2vxfAAD0eZxzCKakxg55G4";
    s.crossOrigin = "anonymous";
    s.onload = () => {
      try {
        if (window.Kakao && !window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JS_KEY);
        resolve(window.Kakao);
      } catch (_) {
        resolve(null);
      }
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loader;
}

export async function shareKakao({ url, title, description }) {
  const Kakao = await loadSdk();
  if (!Kakao || !Kakao.Share) return false;
  try {
    Kakao.Share.sendDefault({
      objectType: "feed",
      content: {
        title,
        description,
        imageUrl: "https://aiparty.kr/og-main-v2.png",
        link: { mobileWebUrl: url, webUrl: url },
      },
      buttons: [
        { title: "서명하러 가기", link: { mobileWebUrl: url, webUrl: url } },
      ],
    });
    return true;
  } catch (_) {
    return false;
  }
}
