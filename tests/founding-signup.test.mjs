import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFoundingSignup, foundingSignupError } from '../public/community/founding-signup.js';

const founder = {
  name: '비공개 성명', birth_date: '1990-01-01', address: '비공개 주소 상세', gender: '남',
  occupation: '비공개 직업', phone_home: null, phone_mobile: '010-1234-5678',
  signature_data: 'data:image/png;base64,private-signature', agreed_at: '2026-10-09',
  privacy_agreed: true, public_consent: false,
};
const input = { email: 'Member@Example.com', password: 'long-private-password', username: 'member_1', displayName: '', referrerUsername: '', founder };

function app({ user = null, authError = null, identities = [{}], completed = false, prepareError = null } = {}) {
  const calls = [];
  let currentUser = user;
  let currentAuthError = authError;
  let committed = completed;
  let clock = 1000;
  const supabase = {
    rpc: async (name, payload) => {
      calls.push([name, payload]);
      if (name === 'community_referrer_exists') return { data: payload.p_username === 'inviter', error: null };
      if (name === 'community_prepare_founding_signup') return { data: prepareError ? null : { token: 'private-receipt' }, error: prepareError };
      if (name === 'community_founding_signup_status') return { data: { completed: committed }, error: null };
      if (name === 'community_submit_founding_consent') return { data: { id: 7, already_registered: true }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    auth: {
      async getUser() { calls.push(['getUser']); return { data: { user: currentUser }, error: null }; },
      async signUp(payload) {
        calls.push(['signUp', payload]);
        return { data: currentAuthError ? null : { user: { id: 'user-id', identities }, session: null }, error: currentAuthError };
      },
    },
  };
  const submit = createFoundingSignup(supabase, {
    origin: 'https://aiparty.kr',
    referralData: () => ({ visitor_id: 'visitor-id', referrer_username: 'must-not-copy' }),
    now: () => clock,
  });
  return { calls, submit, setUser(value) { currentUser = value; }, setAuthError(value) { currentAuthError = value; }, setCompleted(value) { committed = value; }, advance(ms) { clock += ms; } };
}

test('one consent creates the profile and founder through prepare before signup, without sensitive metadata', async () => {
  const state = app();
  assert.deepEqual(await state.submit(input), { kind: 'created', verificationRequired: true });
  assert.deepEqual(state.calls.map(([name]) => name), ['getUser', 'community_prepare_founding_signup', 'signUp']);
  const prepared = state.calls[1][1];
  assert.equal(prepared.p_founder, founder);
  assert.equal(prepared.p_display_name, 'member_1');
  assert.equal(prepared.p_referrer_username, null);
  assert.equal(prepared.p_email, 'member@example.com');
  const signedUp = state.calls[2][1];
  assert.deepEqual(signedUp.options.data, { community_signup: true, founding_signup_token: 'private-receipt', privacy_version: '2026-10-09' });
  assert.equal(signedUp.options.emailRedirectTo, 'https://aiparty.kr/auth?mode=callback');
  assert.equal(signedUp.password, input.password);
  assert.doesNotMatch(JSON.stringify(signedUp.options.data), /비공개|1234|signature|password|birth_date|address/);
});

test('preparation failure prevents any account creation', async () => {
  const state = app({ prepareError: new Error('prepare failed') });
  await assert.rejects(state.submit(input));
  assert.equal(state.calls.some(([name]) => name === 'signUp'), false);
});

test('reserved usernames cannot create a signup draft', async () => {
  const state = app();
  await assert.rejects(state.submit({ ...input, username: 'moderator' }), /invalid_username/);
  assert.equal(state.calls.some(([name]) => name === 'community_prepare_founding_signup'), false);
});

test('only an explicitly entered and validated referrer reaches the prepare RPC', async () => {
  const state = app();
  await state.submit({ ...input, referrerUsername: ' INVITER ' });
  assert.equal(state.calls.find(([name]) => name === 'community_prepare_founding_signup')[1].p_referrer_username, 'inviter');
  const missing = app();
  await assert.rejects(missing.submit({ ...input, referrerUsername: 'missing' }), /invalid_referrer/);
  assert.equal(missing.calls.some(([name]) => name === 'signUp'), false);
  const self = app();
  await assert.rejects(self.submit({ ...input, referrerUsername: 'member_1' }), /invalid_referrer/);
});

test('mail or network failure reports success only after the receipt confirms a committed founder', async () => {
  const committed = app({ authError: new Error('SMTP failure'), completed: true });
  assert.deepEqual(await committed.submit(input), { kind: 'created', verificationRequired: true, recovered: true });
  const uncommitted = app({ authError: new Error('network failure') });
  await assert.rejects(uncommitted.submit(input), /network failure/);
  uncommitted.setAuthError(null);
  await uncommitted.submit(input);
  assert.equal(uncommitted.calls.filter(([name]) => name === 'community_prepare_founding_signup').length, 1);
  assert.equal(uncommitted.calls.filter(([name]) => name === 'signUp').length, 2);
});

test('retry recovers a previous committed request without creating an account twice', async () => {
  const state = app({ authError: new Error('network failure') });
  await assert.rejects(state.submit(input));
  state.setCompleted(true);
  assert.equal((await state.submit(input)).recovered, true);
  assert.equal(state.calls.filter(([name]) => name === 'signUp').length, 1);
});

test('an uncommitted draft is renewed before expiry only after checking its receipt', async () => {
  const state = app({ authError: new Error('network failure') });
  await assert.rejects(state.submit(input));
  state.advance(14 * 60 * 1000);
  state.setAuthError(null);
  await state.submit(input);
  assert.equal(state.calls.filter(([name]) => name === 'community_prepare_founding_signup').length, 2);
  const secondPrepare = state.calls.findLastIndex(([name]) => name === 'community_prepare_founding_signup');
  assert.equal(state.calls[secondPrepare - 1][0], 'community_founding_signup_status');
});

test('an existing email reports success only if this request receipt confirms account and consent', async () => {
  const state = app({ identities: [] });
  await assert.rejects(state.submit(input), /existing_email/);
  assert.equal(state.calls.some(([name]) => name === 'community_founding_signup_status'), true);
  assert.match(foundingSignupError({ code: 'existing_email' }), /로그인/);
  const recovered = app({ identities: [], completed: true });
  assert.equal((await recovered.submit(input)).recovered, true);
});

test('verified existing members submit only consent; current auth state is rechecked on every submission', async () => {
  const state = app({ user: { id: 'member', email_confirmed_at: '2026-10-09' } });
  assert.deepEqual(await state.submit(input), { kind: 'existing', alreadyRegistered: true });
  assert.deepEqual(state.calls.map(([name]) => name), ['getUser', 'community_submit_founding_consent']);
  assert.deepEqual(state.calls[1][1], { p_founder: founder });
  state.setUser({ id: 'member', email_confirmed_at: null });
  await assert.rejects(state.submit(input), /verification_required/);
  assert.equal(state.calls.filter(([name]) => name === 'community_submit_founding_consent').length, 1);
});

test('client and form never write founder data to browser storage or perform a raw insert', async () => {
  const module = await readFile(new URL('../public/community/founding-signup.js', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /localStorage|sessionStorage|console\./);
  assert.doesNotMatch(page, /\.from\('founding_members'\)\.insert|console\.error/);
  assert.match(page, /id="signup-email"/);
  assert.match(page, /id="signup-password"/);
  assert.match(page, /id="signup-username"/);
  assert.match(page, /발기인 동의하고 가입하기/);
  assert.match(page, /href="\/community\/privacy"/);
  assert.match(page, /<form id="founding-member-form" method="post" inert[^>]*aria-busy="true"/);
  assert.match(page, /id="submit-btn"\s+disabled/);
  assert.match(page, /<noscript>/);
  assert.ok(page.indexOf("form.addEventListener('submit'") < page.indexOf("form.removeAttribute('inert')"));
});
