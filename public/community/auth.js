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
  const descriptions = {
    login: '발기인 동의로 가입한 계정으로 로그인하세요.',
    signup: '발기인 동의와 사이트 가입을 한 번에 진행합니다.',
    reset: '가입한 이메일로 비밀번호 재설정 링크를 받으세요.',
    recovery: '계정에 사용할 새 비밀번호를 설정하세요.',
    verify: '이메일 인증을 마치면 계정을 이용할 수 있습니다.',
  };
  byId('auth-title').textContent = titles[mode];
  byId('auth-description').textContent = descriptions[mode];
  root.setAttribute('aria-busy', 'false');
  if (focus) byId('auth-title').focus();
}

function navigateTo(value) {
  const url = new URL('/auth', window.location.origin);
  if (value !== 'login') url.searchParams.set('mode', value);
  if (next !== '/account') url.searchParams.set('next', next);
  window.history.replaceState(null, '', url.pathname + url.search);
  setMessage(message, '');
  if (value === 'verify') {
    pendingEmail = byId('login-email').value.trim() || pendingEmail || byId('resend-email').value.trim();
    showVerification(true);
  } else showMode(value, true);
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
    const email = byId('login-email').value.trim();
    const { error } = await supabase.auth.signInWithPassword({
      email, password: byId('login-password').value,
    });
    if (error?.code === 'email_not_confirmed' || /email not confirmed/i.test(error?.message || '')) {
      pendingEmail = email;
      byId('login-password').value = '';
      showVerification(true);
      setMessage(message, '이메일 인증이 필요합니다. 메일함을 확인하거나 아래에서 인증 메일을 다시 요청해 주세요.', true);
      return;
    }
    if (error) throw error;
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!data.user?.email_confirmed_at) {
      pendingEmail = email;
      byId('login-password').value = '';
      showVerification(true);
      setMessage(message, '가입한 이메일의 인증 링크를 열어 이메일 인증을 완료해 주세요.', true);
      return;
    }
    window.location.assign(next);
  });
});

function showVerification(focus = false) {
  byId('verification-email').textContent = pendingEmail || '가입한 이메일';
  byId('resend-email').value = pendingEmail;
  showMode('verify', focus);
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

// A recovery form needs a validated PASSWORD_RECOVERY event.
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
  if (['error', 'error_code', 'error_description'].some((key) => params.has(key) || fragment.has(key))) {
    navigateTo(requestedMode === 'recovery' ? 'reset' : 'verify');
    setMessage(message, '인증 링크가 만료되었거나 유효하지 않습니다. 메일을 다시 요청해 주세요.', true);
    return;
  }
  // Wait for the SDK's automatic URL handling before attempting a PKCE fallback.
  // initialize() also reports URL verification errors that getSession() omits.
  const { error: initializationError } = await supabase.auth.initialize();
  if (initializationError) {
    navigateTo(requestedMode === 'recovery' ? 'reset' : 'verify');
    setMessage(message, '인증 링크를 확인하지 못했습니다. 아래에서 새 메일을 요청해 주세요.', true);
    return;
  }
  const code = new URLSearchParams(window.location.search).get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // The SDK may have already exchanged the URL code during initialization.
    // Only its PASSWORD_RECOVERY event can authorize that recovery path.
    if (error && !recoveryUserId) {
      navigateTo(requestedMode === 'recovery' ? 'reset' : 'verify');
      setMessage(message, '인증 링크를 확인하지 못했습니다. 같은 브라우저에서 새 링크를 요청해 주세요.', true);
      return;
    }
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
    showVerification();
    setMessage(message, '인증 링크를 확인하지 못했습니다. 인증 메일을 다시 요청하거나 로그인해 주세요.', true);
    return;
  }
  if (!error && data.user?.email_confirmed_at && ['login', 'verify'].includes(requestedMode)) {
    window.location.replace(next);
    return;
  }
  if (requestedMode === 'verify') {
    pendingEmail = data.user?.email || '';
    showVerification();
  } else showMode(requestedMode);
  setMessage(message, '');
}

initialize().catch((error) => {
  showMode('login');
  setMessage(message, authError(error), true);
});
