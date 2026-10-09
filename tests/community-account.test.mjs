import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildReferralUrl } from '../public/community/referral.js';

const source = (await readFile(new URL('../public/community/account.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
const page = await readFile(new URL('../src/pages/account.astro', import.meta.url), 'utf8');
const profile = { display_name: '참여자', username: 'member_1' };
const statistics = (links = []) => ({ visitors: 5, signups: 2, manual_signups: 1, links });

async function setup(responses) {
  const elements = new Map();
  const calls = [];
  const copied = [];
  function node(tag = 'div') {
    return {
      tag, textContent: '', value: '', hidden: false, disabled: false, children: [], listeners: new Map(), attributes: new Map(),
      classList: { toggle() {} },
      addEventListener(name, listener) { this.listeners.set(name, listener); },
      setAttribute(name, value) { this.attributes.set(name, value); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      querySelector() { return this.button ||= node('button'); },
    };
  }
  for (const [, tag, attributes, id] of page.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = node(tag);
    element.hidden = /\bhidden\b/.test(attributes);
    elements.set(id, element);
  }
  const element = (id) => {
    assert.ok(elements.has(id), `Missing account element: ${id}`);
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element }, Intl,
    supabase: {
      async rpc(name, payload) {
        calls.push([name, payload]);
        if (name === 'community_my_referrals') {
          const result = responses.shift();
          assert.notEqual(result, undefined, 'Unexpected statistics request');
          return result instanceof Error ? { data: null, error: result } : { data: result, error: null };
        }
        assert.equal(name, 'community_create_link');
        return { error: null };
      },
    },
    requireUser: async () => ({ email_confirmed_at: '2026-10-09' }),
    getProfile: async () => profile,
    authError: () => '요청을 처리하지 못했습니다.',
    buildReferralUrl,
    el(tag, className, text) { const result = node(tag); result.className = className; result.textContent = text ?? ''; return result; },
    setMessage(target, text, isError = false) { target.textContent = text; target.hidden = !text; target.isError = isError; },
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
  });
  await vm.runInContext(`(async () => { ${source} })()`, context);
  return {
    element, calls, copied,
    messages: () => [...elements.values()].filter((item) => !item.hidden && item.textContent && ('isError' in item)),
    refresh: () => element('refresh-referrals').listeners.get('click')(),
    async createLink() {
      element('utm-source').value = 'kakao';
      element('utm-medium').value = 'share';
      element('utm-campaign').value = 'friends';
      await element('link-form').listeners.get('submit')({ preventDefault() {}, currentTarget: element('link-form') });
    },
  };
}

test('a successful retry replaces failed account statistics without leaving a stale error', async () => {
  const app = await setup([new Error('offline'), statistics()]);
  assert.ok(app.messages().some((message) => message.isError && /현황/.test(message.textContent)));
  await app.refresh();
  assert.equal(app.element('referral-visitors').textContent, '5');
  assert.equal(app.element('referral-signups').textContent, '2');
  assert.equal(app.messages().some((message) => message.isError), false);
  assert.equal(app.element('refresh-referrals').disabled, false);
});

test('link creation remains confirmed when refreshing its list fails, without claiming the link is visible', async () => {
  const app = await setup([statistics(), new Error('offline'), statistics()]);
  await app.createLink();
  assert.equal(app.calls.filter(([name]) => name === 'community_create_link').length, 1);
  assert.match(app.element('account-message').textContent, /링크를 만들었습니다/);
  assert.doesNotMatch(app.element('account-message').textContent, /아래에서 복사/);
  assert.ok(app.messages().some((message) => message.isError && /새로고침/.test(message.textContent)));
  assert.equal(app.element('link-form').button.disabled, false);
  await app.refresh();
  assert.equal(app.messages().some((message) => message.isError), false);
  assert.match(app.element('account-message').textContent, /링크를 만들었습니다/);
});

test('a successfully refreshed new campaign exposes a working copy button', async () => {
  const campaign = { slug: 'friends_link', campaign: 'friends', source: 'kakao', medium: 'share', visitors: 0, signups: 0 };
  const app = await setup([statistics(), statistics([campaign])]);
  await app.createLink();
  assert.match(app.element('account-message').textContent, /아래에서 복사/);
  const row = app.element('campaign-list').children[0];
  const actions = row.children.at(-1);
  await actions.children[0].listeners.get('click')();
  assert.deepEqual(app.copied, [buildReferralUrl(profile, campaign)]);
  assert.equal(app.messages().some((message) => message.isError), false);
});
