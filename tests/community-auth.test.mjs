import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/community/auth.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
const page = await readFile(new URL('../src/pages/auth.astro', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function setup({ url = 'https://aiparty.kr/auth', user = null, sessionEvent, autoHandleCode = false, signInError = null, initializationError = null, exchangeError = null } = {}) {
  const elements = new Map();
  const calls = [];
  const redirects = [];
  let authListener;
  let currentUser = user;
  let userChecks = 0;
  let currentUrl = new URL(url);
  const element = (id) => {
    if (!elements.has(id)) {
      const attributes = new Map();
      elements.set(id, {
        value: '', checked: false, hidden: true, textContent: '', disabled: false,
        listeners: new Map(),
        addEventListener(name, listener) { this.listeners.set(name, listener); },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); },
        querySelectorAll() { return []; },
        reportValidity() { return true; },
        focus() { this.focused = true; },
      });
    }
    return elements.get(id);
  };
  const ok = (name) => async (payload, options) => { calls.push([name, payload, options]); return { data: {}, error: null }; };
  const links = [...page.matchAll(/data-auth-mode="([^"]+)"/g)].map((match, index) => {
    const link = element(`auth-link-${index}`);
    link.dataset = { authMode: match[1] };
    return link;
  });
  const supabase = {
    auth: {
      onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
      async initialize() {
        if (autoHandleCode) currentUrl.searchParams.delete('code');
        if (sessionEvent) authListener(sessionEvent, { user: currentUser });
        return { error: initializationError };
      },
      async getUser() { ++userChecks; return { data: { user: currentUser }, error: null }; },
      async signInWithPassword(payload) {
        calls.push(['signInWithPassword', payload]);
        return { data: { user: null, session: null }, error: signInError };
      },
      signUp: ok('signUp'), resend: ok('resend'), resetPasswordForEmail: ok('resetPasswordForEmail'),
      updateUser: ok('updateUser'),
      async exchangeCodeForSession(code) {
        calls.push(['exchangeCodeForSession', code]);
        return { data: { session: currentUser ? { user: currentUser } : null }, error: exchangeError };
      },
    },
  };
  const location = {
    get search() { return currentUrl.search; },
    get hash() { return currentUrl.hash; },
    get origin() { return currentUrl.origin; },
    assign(value) { redirects.push(['assign', value]); },
    replace(value) { redirects.push(['replace', value]); },
  };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => links },
    window: { location, history: { replaceState(_state, _title, value) { currentUrl = new URL(value, currentUrl); } } },
    supabase, URL, URLSearchParams,
    authError: () => '요청을 처리하지 못했습니다. 다시 시도해 주세요.',
    setMessage(target, text, isError = false) { target.textContent = text; target.hidden = !text; target.isError = isError; },
    safeNext(value) { return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/account'; },
  });
  vm.runInContext(source, context);
  await tick();
  return {
    element, calls, redirects,
    userChecks: () => userChecks,
    currentLocation: () => currentUrl,
    setUser(value) { currentUser = value; },
    emit(event, session) { authListener(event, session); },
    async navigate(mode) {
      links.find((link) => link.dataset.authMode === mode).listeners.get('click')({ button: 0, preventDefault() {} });
      await tick();
    },
    async submit(id) {
      const form = element(id);
      form.listeners.get('submit')({ preventDefault() {}, currentTarget: form });
      await tick();
    },
  };
}

test('legacy signup addresses open the unified founder consent form', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=signup&next=%2Faccount%3Ftab%3Dlinks' });
  assert.deepEqual(app.redirects, [['replace', '/#founding-members']]);
  assert.equal(app.calls.some(([name]) => name === 'signUp'), false);
  assert.equal(app.element('signup-panel').hidden, false);
  assert.match(app.element('auth-message').textContent, /발기인 동의/);
});

test('signup navigation stays unified for a user who is already signed in', async () => {
  const app = await setup({
    url: 'https://aiparty.kr/auth?mode=signup',
    user: { id: 'existing', email_confirmed_at: '2026-10-09' },
  });
  assert.deepEqual(app.redirects, [['replace', '/#founding-members']]);
  assert.equal(app.calls.length, 0);
});

test('verified login continues to the safe requested destination', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?next=%2Faccount%3Ftab%3Dlinks' });
  app.element('login-email').value = 'member@example.com';
  app.element('login-password').value = 'a-long-password';
  app.setUser({ id: 'member', email_confirmed_at: '2026-10-09' });
  await app.submit('login-form');
  assert.equal(app.calls.filter(([name]) => name === 'signInWithPassword').length, 1);
  assert.deepEqual(app.redirects, [['assign', '/account?tab=links']]);
});

test('unverified sign-in shows verification without redirecting', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth', user: { id: 'member', email_confirmed_at: null } });
  app.element('login-email').value = 'member@example.com';
  app.element('login-password').value = 'a-long-password';
  await app.submit('login-form');
  assert.equal(app.element('verify-panel').hidden, false);
  assert.equal(app.redirects.length, 0);
});

test('real email_not_confirmed sign-in errors open resend before any user lookup', async () => {
  const app = await setup({ signInError: { code: 'email_not_confirmed', message: 'Email not confirmed', status: 400 } });
  const initialUserChecks = app.userChecks();
  app.element('login-email').value = ' pending@example.com ';
  app.element('login-password').value = 'a-long-password';
  await app.submit('login-form');
  assert.equal(app.element('verify-panel').hidden, false);
  assert.equal(app.element('resend-email').value, 'pending@example.com');
  assert.equal(app.element('verification-email').textContent, 'pending@example.com');
  assert.equal(app.element('login-password').value, '');
  assert.equal(app.userChecks(), initialUserChecks);
  assert.equal(app.redirects.length, 0);
  assert.equal(app.calls.some(([name]) => name === 'resend'), false);
  assert.match(app.element('auth-message').textContent, /이메일 인증이 필요/);
});

test('wrong passwords remain on login rather than being treated as unverified email', async () => {
  const app = await setup({ signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
  app.element('login-email').value = 'member@example.com';
  app.element('login-password').value = 'wrong-password';
  await app.submit('login-form');
  assert.equal(app.element('login-panel').hidden, false);
  assert.equal(app.element('verify-panel').hidden, true);
  assert.equal(app.element('auth-message').isError, true);
  assert.equal(app.redirects.length, 0);
});

test('the visible resend affordance carries the entered email into verification', async () => {
  const app = await setup();
  app.element('login-email').value = ' member@example.com ';
  await app.navigate('verify');
  assert.equal(app.element('verify-panel').hidden, false);
  assert.equal(app.element('resend-email').value, 'member@example.com');
  assert.equal(app.currentLocation().searchParams.get('mode'), 'verify');
  assert.equal(app.calls.length, 0);
});

test('the signup success verification route works without an email in its URL', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=verify' });
  assert.equal(app.element('verify-panel').hidden, false);
  assert.equal(app.element('verification-email').textContent, '가입한 이메일');
  assert.equal(app.element('resend-email').value, '');
  assert.equal(app.calls.length, 0);
  app.element('resend-email').value = 'new@example.com';
  await app.submit('resend-form');
  const resend = app.calls.find(([name]) => name === 'resend')[1];
  assert.equal(resend.email, 'new@example.com');
  assert.equal(new URL(resend.options.emailRedirectTo).searchParams.get('mode'), 'callback');
});

test('expired confirmation callbacks offer resend and remove URL errors while keeping a safe next path', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=callback&error_code=otp_expired&next=%2Faccount%3Ftab%3Dlinks' });
  assert.equal(app.element('verify-panel').hidden, false);
  assert.equal(app.element('auth-message').isError, true);
  assert.equal(app.currentLocation().searchParams.has('error_code'), false);
  assert.equal(app.currentLocation().searchParams.get('mode'), 'verify');
  assert.equal(app.currentLocation().searchParams.get('next'), '/account?tab=links');
  assert.equal(app.redirects.length, 0);
});

test('SDK callback initialization errors and rejected exchange codes leave resend available', async () => {
  const initialized = await setup({
    url: 'https://aiparty.kr/auth?mode=callback',
    initializationError: { code: 'otp_expired', message: 'Token has expired or is invalid' },
  });
  assert.equal(initialized.element('verify-panel').hidden, false);
  assert.equal(initialized.element('auth-message').isError, true);
  assert.equal(initialized.redirects.length, 0);

  const exchanged = await setup({
    url: 'https://aiparty.kr/auth?mode=callback&code=expired',
    exchangeError: { code: 'flow_state_expired', message: 'Invalid flow state' },
  });
  assert.equal(exchanged.element('verify-panel').hidden, false);
  assert.equal(exchanged.currentLocation().searchParams.has('code'), false);
  assert.equal(exchanged.redirects.length, 0);
});

test('expired recovery links offer a new recovery email instead of signup resend', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=recovery#error_code=otp_expired' });
  assert.equal(app.element('reset-panel').hidden, false);
  assert.equal(app.element('verify-panel').hidden, true);
  assert.equal(app.currentLocation().hash, '');
  assert.equal(app.element('auth-message').isError, true);
});

test('recovery mode alone cannot change the password of an existing session', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=recovery', user: { id: 'existing', email_confirmed_at: '2026-10-09' } });
  assert.equal(app.element('reset-panel').hidden, false);
  app.element('recovery-password').value = 'new-long-password';
  app.element('recovery-confirm').value = 'new-long-password';
  await app.submit('recovery-form');
  assert.equal(app.calls.some(([name]) => name === 'updateUser'), false);
});

test('a successful ordinary code exchange cannot authorize recovery without PASSWORD_RECOVERY', async () => {
  const app = await setup({
    url: 'https://aiparty.kr/auth?mode=recovery&code=ordinary-signin-code',
    user: { id: 'ordinary-user', email_confirmed_at: '2026-10-09' },
  });
  assert.equal(app.element('reset-panel').hidden, false);
  app.element('recovery-password').value = 'new-long-password';
  app.element('recovery-confirm').value = 'new-long-password';
  await app.submit('recovery-form');
  assert.equal(app.calls.some(([name]) => name === 'updateUser'), false);
});

test('validated recovery permits a change only while the recovered user remains signed in', async () => {
  const user = { id: 'recovered', email_confirmed_at: '2026-10-09' };
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=recovery', user, sessionEvent: 'PASSWORD_RECOVERY' });
  assert.equal(app.element('recovery-panel').hidden, false);
  app.element('recovery-password').value = 'new-long-password';
  app.element('recovery-confirm').value = 'different-password';
  await app.submit('recovery-form');
  assert.equal(app.calls.some(([name]) => name === 'updateUser'), false);
  app.element('recovery-confirm').value = 'new-long-password';
  await app.submit('recovery-form');
  assert.equal(app.calls.filter(([name]) => name === 'updateUser').length, 1);
  assert.equal(app.element('login-panel').hidden, false);

  const stale = await setup({ url: 'https://aiparty.kr/auth?mode=recovery', user, sessionEvent: 'PASSWORD_RECOVERY' });
  stale.element('recovery-password').value = 'new-long-password';
  stale.element('recovery-confirm').value = 'new-long-password';
  stale.setUser(null);
  await stale.submit('recovery-form');
  assert.equal(stale.calls.some(([name]) => name === 'updateUser'), false);
  assert.equal(stale.element('reset-panel').hidden, false);
});

test('SDK auto-exchanged callbacks are not exchanged twice and retain a safe next path', async () => {
  const app = await setup({
    url: 'https://aiparty.kr/auth?mode=callback&code=already-used&next=%2Faccount%3Ftab%3Dlinks',
    user: { id: 'verified', email_confirmed_at: '2026-10-09' }, autoHandleCode: true,
  });
  assert.equal(app.calls.some(([name]) => name === 'exchangeCodeForSession'), false);
  assert.deepEqual(app.redirects, [['replace', '/account?tab=links']]);
});

test('a callback never redirects an unverified or missing user', async () => {
  for (const user of [null, { id: 'pending', email_confirmed_at: null }]) {
    const app = await setup({ url: 'https://aiparty.kr/auth?mode=callback', user });
    assert.equal(app.element('verify-panel').hidden, false);
    assert.equal(app.redirects.length, 0);
  }
});

test('reset and verification resend use the canonical callback and block external next paths', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=reset&next=%2F%2Fevil.example' });
  app.element('reset-email').value = 'member@example.com';
  await app.submit('reset-form');
  const reset = app.calls.find(([name]) => name === 'resetPasswordForEmail');
  const resetUrl = new URL(reset[2].redirectTo);
  assert.equal(resetUrl.origin, 'https://aiparty.kr');
  assert.equal(resetUrl.searchParams.get('mode'), 'recovery');
  assert.equal(resetUrl.searchParams.get('next'), '/account');
  app.element('resend-email').value = 'member@example.com';
  await app.submit('resend-form');
  assert.equal(app.calls.find(([name]) => name === 'resend')[1].type, 'signup');
});

test('auth keeps a direct unified signup link and no independent signup fields or API', () => {
  assert.match(page, /href="\/#founding-members">발기인 동의하고 가입하기<\/a>/);
  assert.match(page, /발기인 동의와 사이트 가입을 한 번에 진행/);
  assert.doesNotMatch(page, /id="signup-(form|username|name|email|password|referrer|privacy)"/);
  assert.doesNotMatch(page, /사이트 가입과 발기인 참여 신청은 별도/);
  assert.doesNotMatch(source, /auth\.signUp\s*\(|community_username_available|community_referrer_exists|signupReferralData/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(page, /src="\/community\/auth\.js" is:inline/);
  assert.match(page, /href="\/auth\?mode=verify" data-auth-mode="verify">인증 메일 다시 받기/);
  const forms = [...page.matchAll(/<form\b([^>]*)>/g)];
  assert.equal(forms.length, 4);
  assert.ok(forms.every(([, attributes]) => /method="post"/.test(attributes)));
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|console\.log/);
});

test('all remaining auth controls referenced by the module exist in the page', () => {
  const ids = new Set([...page.matchAll(/\bid="([^"\s]+)"/g)].map((match) => match[1]));
  for (const [, id] of source.matchAll(/byId\('([^']+)'\)/g)) {
    assert.ok(ids.has(id), `Missing auth element: ${id}`);
  }
});
