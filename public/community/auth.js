import { supabase, authError, setMessage, safeNext } from './client.js';

const byId = (id) => document.getElementById(id);
const root = byId('auth-root');
const message = byId('auth-message');
const params = new URLSearchParams(window.location.search);
const next = safeNext(params.get('next') || '/account');
const panels = ['login', 'signup'];

function callbackUrl() {
  const url = new URL('/auth', window.location.origin);
  url.searchParams.set('mode', 'callback');
  url.searchParams.set('next', next);
  return url.href;
}

function showMode(value) {
  const mode = panels.includes(value) ? value : 'login';
  for (const panel of panels) byId(`${panel}-panel`).hidden = panel !== mode;
  byId('auth-title').textContent = mode === 'signup' ? '발기인 동의로 가입하기' : '로그인';
  byId('auth-description').textContent = mode === 'signup'
    ? '로그인한 뒤 발기인 동의서를 작성해 주세요.'
    : '카카오나 Google 계정으로 로그인하세요.';
  root.setAttribute('aria-busy', 'false');
}

function showLoginFailure() {
  showMode('login');
  setMessage(message, '로그인을 완료하지 못했습니다. 카카오나 Google 버튼을 다시 눌러 주세요.', true);
}

// Accounts are created only through Kakao or Google sign-in. The provider
// returns here, and a session with a confirmed email decides the next page.
for (const button of document.querySelectorAll('[data-oauth]')) {
  button.addEventListener('click', async () => {
    const buttons = document.querySelectorAll('[data-oauth]');
    buttons.forEach((item) => { item.disabled = true; });
    setMessage(message, '로그인 화면으로 이동합니다.');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: button.dataset.oauth,
        options: { redirectTo: callbackUrl() },
      });
      if (error) throw error;
    } catch (error) {
      buttons.forEach((item) => { item.disabled = false; });
      setMessage(message, authError(error), true);
    }
  });
}

async function initialize() {
  const requestedMode = params.get('mode') || 'login';
  if (requestedMode === 'signup') {
    showMode('signup');
    setMessage(message, '발기인 동의서 화면으로 이동합니다.');
    window.location.replace('/#founding-members');
    return;
  }
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (['error', 'error_code', 'error_description'].some((key) => params.has(key) || fragment.has(key))) {
    showLoginFailure();
    return;
  }
  // Wait for the SDK's automatic URL handling before attempting a PKCE fallback.
  const { error: initializationError } = await supabase.auth.initialize();
  if (initializationError) {
    showLoginFailure();
    return;
  }
  const code = new URLSearchParams(window.location.search).get('code');
  if (code) {
    // The SDK may have already exchanged the URL code during initialization.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    const { data } = await supabase.auth.getUser();
    if (error && !data?.user) {
      showLoginFailure();
      return;
    }
  }
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user?.email_confirmed_at) {
    window.location.replace(next);
    return;
  }
  if (requestedMode === 'callback' || (!error && data.user)) {
    showMode('login');
    setMessage(message, '이메일이 확인된 카카오 또는 Google 계정으로 로그인해 주세요.', true);
    return;
  }
  showMode('login');
  setMessage(message, '');
}

initialize().catch((error) => {
  showMode('login');
  setMessage(message, authError(error), true);
});
