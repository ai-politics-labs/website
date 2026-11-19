import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFoundingSignup, foundingSignupError } from '../public/community/founding-signup.js';

const founder = {
  name: '비공개 성명', birth_date: '1990-01-01', address: '비공개 주소 상세', gender: '남',
  occupation: '비공개 직업', phone_home: null, phone_mobile: '010-1234-5678',
  signature_data: 'data:image/png;base64,private-signature', agreed_at: '2026-11-20',
  privacy_agreed: true, public_consent: false,
};
const member = { id: 'member', email_confirmed_at: '2026-11-20' };

function app({ user = member, alreadyRegistered = false, submitError = null } = {}) {
  const calls = [];
  let currentUser = user;
  const supabase = {
    rpc: async (name, payload) => {
      calls.push([name, payload]);
      if (name === 'community_referrer_exists') return { data: payload.p_username === 'inviter', error: null };
      if (name === 'community_submit_founding_consent_referred') return { data: submitError ? null : { id: 7, already_registered: alreadyRegistered }, error: submitError };
      throw new Error(`Unexpected RPC ${name}`);
    },
    auth: { async getUser() { calls.push(['getUser']); return { data: { user: currentUser }, error: null }; } },
  };
  const submit = createFoundingSignup(supabase, { referralData: () => ({ visitor_id: 'visitor-id', referrer_username: 'must-not-copy' }) });
  return { calls, submit, setUser(value) { currentUser = value; } };
}

test('a signed-in member submits consent with the visit that brought them', async () => {
  const state = app();
  assert.deepEqual(await state.submit({ referrerUsername: '', founder }), { kind: 'existing', alreadyRegistered: false });
  assert.deepEqual(state.calls.map(([name]) => name), ['getUser', 'community_submit_founding_consent_referred']);
  assert.deepEqual(state.calls[1][1], { p_founder: founder, p_referrer_username: null, p_visitor_id: 'visitor-id' });
});

test('an entered referrer is normalized and validated before consent is sent', async () => {
  const state = app();
  await state.submit({ referrerUsername: ' Inviter ', founder });
  assert.deepEqual(state.calls.map(([name]) => name), ['getUser', 'community_referrer_exists', 'community_submit_founding_consent_referred']);
  assert.equal(state.calls[2][1].p_referrer_username, 'inviter');
  await assert.rejects(app().submit({ referrerUsername: 'nobody', founder }), /invalid_referrer/);
  const malformed = app();
  await assert.rejects(malformed.submit({ referrerUsername: 'Not Valid!', founder }), /invalid_referrer/);
  assert.deepEqual(malformed.calls.map(([name]) => name), ['getUser']);
});

test('visitors who are not signed in or not confirmed cannot submit, and state is rechecked every time', async () => {
  const state = app({ user: null });
  await assert.rejects(state.submit({ founder }), /login_required/);
  state.setUser({ id: 'member', email_confirmed_at: null });
  await assert.rejects(state.submit({ founder }), /verification_required/);
  assert.equal(state.calls.some(([name]) => name === 'community_submit_founding_consent_referred'), false);
  state.setUser(member);
  await state.submit({ founder });
  assert.equal(state.calls.filter(([name]) => name === 'getUser').length, 3);
});

test('a repeated submission reports the existing consent instead of a new one', async () => {
  assert.deepEqual(await app({ alreadyRegistered: true }).submit({ founder }), { kind: 'existing', alreadyRegistered: true });
});

test('server errors surface as actionable messages', async () => {
  await assert.rejects(app({ submitError: { code: '22023', message: 'COMMUNITY_SELF_REFERRAL' } }).submit({ founder }));
  assert.match(foundingSignupError({ code: 'login_required' }), /카카오나 Google/);
  assert.match(foundingSignupError({ message: 'COMMUNITY_AUTH_REQUIRED' }), /로그인/);
  assert.match(foundingSignupError({ message: 'COMMUNITY_SELF_REFERRAL' }), /내 아이디/);
  assert.match(foundingSignupError({ message: 'COMMUNITY_REFERRER_INVALID' }), /추천인/);
});

test('the form collects no password and never writes founder data to storage or a raw insert', async () => {
  const module = await readFile(new URL('../public/community/founding-signup.js', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /localStorage|sessionStorage|console\.|signUp|password/);
  assert.doesNotMatch(page, /\.from\('founding_members'\)\.insert|console\.error/);
  assert.doesNotMatch(page, /id="signup-email"|id="signup-password"|id="signup-username"|type="password"/);
  assert.match(page, /href="\/auth\?next=%2F%23founding-members"/);
  assert.match(page, /href="\/community\/privacy"/);
  assert.match(page, /<form id="founding-member-form" method="post" inert[^>]*aria-busy="true"/);
  assert.match(page, /id="submit-btn"\s+disabled/);
  assert.match(page, /<noscript>/);
  assert.ok(page.indexOf("form.addEventListener('submit'") < page.indexOf("form.removeAttribute('inert')"));
});
