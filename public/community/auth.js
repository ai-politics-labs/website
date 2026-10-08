import { supabase, authError, setMessage, safeNext } from './client.js';

const byId = (id) => document.getElementById(id);
const root = byId('auth-root');
const message = byId('auth-message');
const params = new URLSearchParams(window.location.search);
const next = safeNext(params.get('next') || '/account');
const panels = ['login', 'signup', 'reset', 'recovery', 'verify'];
let recoveryUserId = null;
let pendingEmail = '';
let mode = 'login';

function callbackUrl(callbackMode) {
  const url = new URL('/auth', window.location.origin);
  url.searchParams.set('mode', callbackMode);
  url.searchParams.set('next', next);
  return url.href;
}

function showMode(value, focus = false) {
  mode = panels.includes(value) ? value : 'login';
  for (const panel of panels) byId(`${panel}-panel`).hidden = panel !== mode;
  const titles = { login: '로그인', signup: '발기인 동의로 가입하기', reset: '비밀번호 찾기', recovery: '새 비밀번호 설정', verify: '이메일 인증' };
  byId('auth-title').textContent = titles[mode];
  root.setAttribute('aria-busy', 'false');
  if (focus) byId('auth-title').focus();
}

function navigateTo(value) {
  const url = new URL('/auth', window.location.origin);
  if (value !== 'login') url.searchParams.set('mode', value);
  if (next !== '/account') url.searchParams.set('next', next);
  window.history.replaceState(null, '', url.pathname + url.search);
  setMessage(message, '');
  showMode(value, true);
}

function setBusy(form, busy) {
  form.setAttribute('aria-busy', String(busy));
  form.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
}

async function submit(form, action) {
  if (form.getAttribute('aria-busy') === 'true' || !form.reportValidity()) return;
  setBusy(form, true);
  setMessage(message, '처리하고 있습니다. 잠시만 기다려 주세요.');
  try { await action(); }
  catch (error) { setMessage(message, authError(error), true); }
  finally { setBusy(form, false); }
}

for (const link of document.querySelectorAll('[data-auth-mode]')) {
  const destination = link.dataset.authMode;
  const url = new URL('/auth', window.location.origin);
  if (destination !== 'login') url.searchParams.set('mode', destination);
  if (next !== '/account') url.searchParams.set('next', next);
  link.href = url.pathname + url.search;
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateTo(destination);
  });
}

byId('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  void submit(form, async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: byId('login-email').value.trim(), password: byId('login-password').value,
    });
    if (error) throw error;
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!data.user?.email_confirmed_at) {
      setMessage(message, '가입한 이메일의 인증 링크를 열어 이메일 인증을 완료해 주세요.', true);
      pendingEmail = byId('login-email').value.trim();
      showVerification();
      return;
    }
    window.location.assign(next);
  });
});

function showVerification() {
  byId('verification-email').textContent = pendingEmail;
  byId('resend-email').value = pendingEmail;
  showMode('verify');
}

byId('resend-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void submit(event.currentTarget, async () => {
    pendingEmail = byId('resend-email').value.trim();
    const { error } = await supabase.auth.resend({
      type: 'signup', email: pendingEmail, options: { emailRedirectTo: callbackUrl('callback') },
    });
    if (error) throw error;
    byId('verification-email').textContent = pendingEmail;
    setMessage(message, '인증 메일을 다시 요청했습니다. 메일함과 스팸함을 확인해 주세요.');
  });
});

byId('reset-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void submit(event.currentTarget, async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(byId('reset-email').value.trim(), {
      redirectTo: callbackUrl('recovery'),
    });
    if (error) throw error;
    setMessage(message, '가입된 이메일이면 비밀번호 재설정 메일이 발송됩니다. 메일함과 스팸함을 확인해 주세요.');
  });
});

byId('recovery-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void submit(event.currentTarget, async () => {
    if (!recoveryUserId) {
      showMode('reset');
      setMessage(message, '유효한 재설정 링크가 필요합니다. 이메일로 새 링크를 요청해 주세요.', true);
      return;
    }
    const password = byId('recovery-password').value;
    if (password.length < 10 || password !== byId('recovery-confirm').value) {
      setMessage(message, password.length < 10 ? '비밀번호를 10자 이상으로 입력해 주세요.' : '비밀번호 확인이 일치하지 않습니다.', true);
      byId('recovery-confirm').focus();
      return;
    }
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user || data.user.id !== recoveryUserId) {
      recoveryUserId = null;
      showMode('reset');
      setMessage(message, '재설정 링크가 만료되었습니다. 이메일로 새 링크를 요청해 주세요.', true);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    recoveryUserId = null;
    byId('recovery-password').value = '';
    byId('recovery-confirm').value = '';
    showMode('login');
    setMessage(message, '비밀번호를 변경했습니다. 새 비밀번호로 로그인할 수 있습니다.');
  });
});

// A recovery form needs a validated recovery event or a successful code exchange.
// Merely adding ?mode=recovery to an address never authorizes a password change.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session?.user?.id) {
    recoveryUserId = session.user.id;
    showMode('recovery');
    setMessage(message, '이메일 인증을 확인했습니다. 새 비밀번호를 입력해 주세요.');
  }
  if (event === 'SIGNED_OUT') recoveryUserId = null;
});

async function initialize() {
  const requestedMode = params.get('mode') || 'login';
  if (requestedMode === 'signup') {
    showMode('signup');
    setMessage(message, '발기인 동의 및 가입 화면으로 이동합니다.');
    window.location.replace('/#founding-members');
    return;
  }
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (params.has('error') || fragment.has('error')) {
    showMode(requestedMode === 'recovery' ? 'reset' : 'login');
    setMessage(message, '인증 링크가 만료되었거나 유효하지 않습니다. 메일을 다시 요청해 주세요.', true);
    window.history.replaceState(null, '', `/auth?mode=${requestedMode === 'recovery' ? 'reset' : 'login'}`);
    return;
  }
  // Wait for the SDK's automatic URL handling before attempting a PKCE fallback.
  await supabase.auth.getSession();
  const code = new URLSearchParams(window.location.search).get('code');
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    // The SDK may have already exchanged the URL code during initialization.
    // Only its PASSWORD_RECOVERY event can authorize that recovery path.
    if (error && !recoveryUserId) {
      showMode(requestedMode === 'recovery' ? 'reset' : 'login');
      setMessage(message, '인증 링크를 확인하지 못했습니다. 같은 브라우저에서 새 링크를 요청해 주세요.', true);
      return;
    }
    if (!error && requestedMode === 'recovery' && data.session?.user?.id) recoveryUserId = data.session.user.id;
  }
  const { data, error } = await supabase.auth.getUser();
  if (requestedMode === 'recovery' || recoveryUserId) {
    if (!error && data.user?.id && data.user.id === recoveryUserId) {
      showMode('recovery');
      setMessage(message, '이메일 인증을 확인했습니다. 새 비밀번호를 입력해 주세요.');
    } else {
      showMode('reset');
      setMessage(message, '유효한 비밀번호 재설정 링크가 필요합니다. 이메일로 새 링크를 요청해 주세요.', true);
    }
    return;
  }
  if (requestedMode === 'callback') {
    if (!error && data.user?.email_confirmed_at) {
      window.location.replace(next);
      return;
    }
    showMode('verify');
    setMessage(message, '인증 링크를 확인하지 못했습니다. 인증 메일을 다시 요청하거나 로그인해 주세요.', true);
    return;
  }
  if (!error && data.user?.email_confirmed_at && requestedMode === 'login') {
    window.location.replace(next);
    return;
  }
  showMode(requestedMode);
  setMessage(message, '');
}

initialize().catch((error) => {
  showMode('login');
  setMessage(message, authError(error), true);
});
