import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/community/auth.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
const page = await readFile(new URL('../src/pages/auth.astro', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function setup({ url = 'https://aiparty.kr/auth', user = null, sessionEvent, autoHandleCode = false } = {}) {
  const elements = new Map();
  const calls = [];
  const redirects = [];
  let authListener;
  let currentUser = user;
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
  const supabase = {
    auth: {
      onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() {
        if (autoHandleCode) currentUrl.searchParams.delete('code');
        if (sessionEvent) authListener(sessionEvent, { user: currentUser });
        return { data: { session: currentUser ? { user: currentUser } : null }, error: null };
      },
      async getUser() { return { data: { user: currentUser }, error: null }; },
      signInWithPassword: ok('signInWithPassword'),
      signUp: ok('signUp'), resend: ok('resend'), resetPasswordForEmail: ok('resetPasswordForEmail'),
      updateUser: ok('updateUser'),
      async exchangeCodeForSession(code) {
        calls.push(['exchangeCodeForSession', code]);
        return { data: { session: currentUser ? { user: currentUser } : null }, error: null };
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
    document: { getElementById: element, querySelectorAll: () => [] },
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
    setUser(value) { currentUser = value; },
    emit(event, session) { authListener(event, session); },
    async submit(id) {
      const form = element(id);
      form.listeners.get('submit')({ preventDefault() {}, currentTarget: form });
      await tick();
    },
  };
}

test('legacy signup addresses open the unified founder consent form', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=signup&next=%2Fboard%2Fwrite' });
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
  const app = await setup({ url: 'https://aiparty.kr/auth?next=%2Fboard%2Fwrite' });
  app.element('login-email').value = 'member@example.com';
  app.element('login-password').value = 'a-long-password';
  app.setUser({ id: 'member', email_confirmed_at: '2026-10-09' });
  await app.submit('login-form');
  assert.equal(app.calls.filter(([name]) => name === 'signInWithPassword').length, 1);
  assert.deepEqual(app.redirects, [['assign', '/board/write']]);
});

test('unverified sign-in shows verification without redirecting', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth', user: { id: 'member', email_confirmed_at: null } });
  app.element('login-email').value = 'member@example.com';
  app.element('login-password').value = 'a-long-password';
  await app.submit('login-form');
  assert.equal(app.element('verify-panel').hidden, false);
  assert.equal(app.redirects.length, 0);
});

test('recovery mode alone cannot change the password of an existing session', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=recovery', user: { id: 'existing', email_confirmed_at: '2026-10-09' } });
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
    url: 'https://aiparty.kr/auth?mode=callback&code=already-used&next=%2Fboard%2Fwrite',
    user: { id: 'verified', email_confirmed_at: '2026-10-09' }, autoHandleCode: true,
  });
  assert.equal(app.calls.some(([name]) => name === 'exchangeCodeForSession'), false);
  assert.deepEqual(app.redirects, [['replace', '/board/write']]);
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
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|console\.log/);
});

test('all remaining auth controls referenced by the module exist in the page', () => {
  const ids = new Set([...page.matchAll(/\bid="([^"\s]+)"/g)].map((match) => match[1]));
  for (const [, id] of source.matchAll(/byId\('([^']+)'\)/g)) {
    assert.ok(ids.has(id), `Missing auth element: ${id}`);
  }
});
