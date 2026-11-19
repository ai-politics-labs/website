import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/community/auth.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
const page = await readFile(new URL('../src/pages/auth.astro', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function setup({ url = 'https://aiparty.kr/auth', user = null, autoHandleCode = false, initializationError = null, exchangeError = null, oauthError = null } = {}) {
  const elements = new Map();
  const calls = [];
  const redirects = [];
  let currentUrl = new URL(url);
  const element = (id) => {
    if (!elements.has(id)) {
      const attributes = new Map();
      elements.set(id, {
        hidden: true, textContent: '', disabled: false, listeners: new Map(),
        addEventListener(name, listener) { this.listeners.set(name, listener); },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); },
      });
    }
    return elements.get(id);
  };
  const socialButtons = [...page.matchAll(/data-oauth="([^"]+)"/g)].map((match, index) => {
    const button = element(`auth-oauth-${index}`);
    button.dataset = { oauth: match[1] };
    return button;
  });
  const supabase = {
    auth: {
      async signInWithOAuth(payload) { calls.push(['signInWithOAuth', payload]); return { data: {}, error: oauthError }; },
      async initialize() {
        calls.push(['initialize']);
        if (autoHandleCode) currentUrl.searchParams.delete('code');
        return { error: initializationError };
      },
      async getUser() { return { data: { user }, error: null }; },
      async exchangeCodeForSession(code) {
        calls.push(['exchangeCodeForSession', code]);
        return { data: { session: user ? { user } : null }, error: exchangeError };
      },
    },
  };
  const location = {
    get search() { return currentUrl.search; },
    get hash() { return currentUrl.hash; },
    get origin() { return currentUrl.origin; },
    replace(value) { redirects.push(['replace', value]); },
  };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: (selector) => (selector === '[data-oauth]' ? socialButtons : []) },
    window: { location },
    supabase, URL, URLSearchParams,
    authError: () => '요청을 처리하지 못했습니다. 다시 시도해 주세요.',
    setMessage(target, text, isError = false) { target.textContent = text; target.hidden = !text; target.isError = isError; },
    safeNext(value) { return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/account'; },
  });
  vm.runInContext(source, context);
  await tick();
  return {
    element, calls, redirects, socialButtons,
    async social(provider) {
      socialButtons.find((button) => button.dataset.oauth === provider).listeners.get('click')();
      await tick();
    },
  };
}

test('the login page offers only Kakao and Google sign-in', () => {
  assert.deepEqual([...page.matchAll(/data-oauth="([^"]+)"/g)].map((match) => match[1]), ['kakao', 'google']);
  assert.doesNotMatch(page, /type="password"|type="email"|login-form|reset-form|recovery-form|resend-form/);
  assert.doesNotMatch(source, /signInWithPassword|signUp\(|resetPasswordForEmail|resend\(|updateUser/);
});

test('legacy signup addresses open the founder consent form', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=signup&next=%2Faccount%3Ftab%3Dlinks' });
  assert.deepEqual(app.redirects, [['replace', '/#founding-members']]);
  assert.equal(app.element('signup-panel').hidden, false);
  assert.equal(app.calls.length, 0);
});

test('a signed-out visitor sees the sign-in buttons without an error', async () => {
  const app = await setup();
  assert.equal(app.element('login-panel').hidden, false);
  assert.equal(app.element('auth-message').hidden, true);
  assert.equal(app.element('auth-root').getAttribute('aria-busy'), 'false');
  assert.equal(app.redirects.length, 0);
});

test('social sign-in returns to the callback with the requested destination', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?next=%2F%23founding-members' });
  await app.social('kakao');
  const [name, payload] = app.calls.at(-1);
  assert.equal(name, 'signInWithOAuth');
  assert.equal(JSON.stringify(payload), JSON.stringify({
    provider: 'kakao',
    options: { redirectTo: 'https://aiparty.kr/auth?mode=callback&next=%2F%23founding-members' },
  }));
  assert.equal(app.socialButtons.every((button) => button.disabled), true);
});

test('a provider failure re-enables the buttons and explains the problem', async () => {
  const app = await setup({ oauthError: new Error('provider unavailable') });
  await app.social('google');
  assert.equal(app.socialButtons.some((button) => button.disabled), false);
  assert.equal(app.element('auth-message').isError, true);
});

test('a confirmed member is sent to the requested safe destination', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=callback&next=%2F%23founding-members', user: { id: 'member', email_confirmed_at: '2026-11-20' } });
  assert.deepEqual(app.redirects, [['replace', '/#founding-members']]);
});

test('an unsafe destination falls back to the account page', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?next=%2F%2Fevil.example', user: { id: 'member', email_confirmed_at: '2026-11-20' } });
  assert.deepEqual(app.redirects, [['replace', '/account']]);
});

test('a callback code is exchanged once when the SDK has not consumed it', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=callback&code=abc', user: { id: 'member', email_confirmed_at: '2026-11-20' } });
  assert.deepEqual(app.calls.filter(([name]) => name === 'exchangeCodeForSession'), [['exchangeCodeForSession', 'abc']]);
  assert.deepEqual(app.redirects, [['replace', '/account']]);
});

test('a code the SDK already handled is not exchanged again', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=callback&code=abc', autoHandleCode: true, user: { id: 'member', email_confirmed_at: '2026-11-20' } });
  assert.equal(app.calls.some(([name]) => name === 'exchangeCodeForSession'), false);
  assert.deepEqual(app.redirects, [['replace', '/account']]);
});

test('a cancelled or failed provider return shows the buttons again with an error', async () => {
  for (const url of ['https://aiparty.kr/auth?mode=callback&error=access_denied', 'https://aiparty.kr/auth?mode=callback#error_code=bad_oauth_state']) {
    const app = await setup({ url });
    assert.equal(app.element('login-panel').hidden, false);
    assert.equal(app.element('auth-message').isError, true);
    assert.equal(app.redirects.length, 0);
    assert.equal(app.calls.length, 0);
  }
});

test('a failed code exchange without a session does not redirect', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=callback&code=abc', exchangeError: new Error('invalid grant') });
  assert.equal(app.redirects.length, 0);
  assert.equal(app.element('auth-message').isError, true);
});

test('an account without a confirmed email is not let through', async () => {
  const app = await setup({ url: 'https://aiparty.kr/auth?mode=callback', user: { id: 'member', email_confirmed_at: null } });
  assert.equal(app.redirects.length, 0);
  assert.equal(app.element('login-panel').hidden, false);
  assert.equal(app.element('auth-message').isError, true);
});
