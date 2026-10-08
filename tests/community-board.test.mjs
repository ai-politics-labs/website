import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const postId = '7e2072ec-354d-42ba-b566-df14b7869bb3';
const member = { id: 'member-id', email_confirmed_at: '2026-10-09T00:00:00Z' };
const post = {
  id: postId, title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>\n일반 텍스트',
  excerpt: '<b>글 미리보기</b>', author_id: member.id, author_username: 'member', author_name: '회원',
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
};

class Element {
  constructor(tag = 'div', className = '', text = '') {
    this.tagName = tag;
    this.className = className;
    this.textContent = text;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = '';
    this.hidden = true;
    this.disabled = true;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() { this.focused = true; }
}

function findClass(element, className) {
  if (element.className.split(' ').includes(className)) return element;
  for (const child of element.children) {
    const match = findClass(child, className);
    if (match) return match;
  }
  return null;
}

async function load(file, { search = '', user = member, profile = { username: 'member' }, rpc = async () => ({ data: null, error: null }), confirm = () => true } = {}) {
  const elements = new Map();
  const calls = [];
  const navigation = [];
  const document = {
    title: '',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
  };
  const source = (await readFile(new URL(`../public/community/${file}`, import.meta.url), 'utf8'))
    .replace(/^import .* from '\.\/client\.js';\n/, '');
  runInNewContext(source, {
    document, URLSearchParams, Intl, window: { location: { search, assign: (url) => navigation.push(url), replace: (url) => navigation.push(url) }, confirm },
    supabase: {
      rpc: async (name, args) => { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return rpc(name, args); },
      auth: { getUser: async () => ({ data: { user } }) },
    },
    requireUser: async () => user,
    getProfile: async () => profile,
    authError: () => '요청을 처리하지 못했습니다.',
    el: (tag, className = '', text = '') => new Element(tag, className, text),
    setMessage: (element, text, isError = false) => { element.textContent = text; element.hidden = false; element.isError = isError; },
  });
  await new Promise(setImmediate);
  return { element: (id) => document.getElementById(id), calls, navigation };
}

test('public list renders untrusted text literally and preserves search across pagination', async () => {
  const page = await load('board.js', {
    search: '?page=2&q=%3Cscript%3E', user: null,
    rpc: async () => ({ data: { total: 41, items: [post], page: 2 }, error: null }),
  });
  assert.deepEqual(page.calls[0], { name: 'community_list_posts', args: { p_page: 2, p_query: '<script>' } });
  const link = findClass(page.element('board-list'), 'board-post-link');
  assert.equal(findClass(link, 'board-post-title').textContent, post.title);
  assert.equal(findClass(link, 'board-excerpt').textContent, post.excerpt);
  assert.equal(findClass(link, 'board-post-title').children.length, 0);
  assert.equal(findClass(page.element('board-list'), 'board-date').dateTime, post.created_at);
  assert.equal(findClass(page.element('board-list'), 'board-date-day').textContent, '금요일');
  assert.equal(findClass(link, 'board-time').textContent, '오전 9:00');
  assert.equal(link.href, `/board/post?id=${postId}`);
  assert.equal(page.element('board-prev').href, '/board?q=%3Cscript%3E');
  assert.equal(page.element('board-next').href, '/board?q=%3Cscript%3E&page=3');
  assert.equal(page.element('board-results').attributes['aria-busy'], 'false');
});

test('list bounds requested pages and distinguishes connection errors from an empty board', async () => {
  const page = await load('board.js', {
    search: '?page=9999999999999999',
    rpc: async () => ({ data: null, error: { message: 'private diagnostic' } }),
  });
  assert.equal(page.calls[0].args.p_page, 10000);
  assert.equal(page.element('board-message').isError, true);
  assert.match(page.element('board-count').textContent, /불러오지 못했습니다/);
  assert.doesNotMatch(page.element('board-message').textContent, /private diagnostic/);
  assert.equal(page.element('board-empty').hidden, true);
});

test('an out-of-range list page returns to the last available page with its search intact', async () => {
  const page = await load('board.js', {
    search: '?page=20&q=test',
    rpc: async () => ({ data: { total: 21, items: [], page: 20 }, error: null }),
  });
  assert.deepEqual(page.navigation, ['/board?q=test&page=2']);
  assert.equal(page.element('board-empty').hidden, true);
});

test('composer blocks unverified members and edits by another author', async () => {
  const unverified = await load('write-post.js', { user: { ...member, email_confirmed_at: null } });
  assert.equal(unverified.element('write-form').hidden, true);
  assert.equal(unverified.element('write-access').hidden, false);
  assert.equal(unverified.calls.length, 0);
  const foreign = await load('write-post.js', {
    search: `?id=${postId}`,
    rpc: async () => ({ data: { ...post, author_id: 'another-member' }, error: null }),
  });
  assert.equal(foreign.element('write-form').hidden, true);
  assert.match(foreign.element('write-message').textContent, /자신이 작성한/);
});

test('composer sends a plain text post through the save RPC and opens the returned post', async () => {
  const page = await load('write-post.js', { rpc: async () => ({ data: postId, error: null }) });
  assert.equal(page.element('write-form').hidden, false);
  page.element('post-title').value = `  ${post.title}  `;
  page.element('post-body').value = `  ${post.body}  `;
  await page.element('write-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(page.calls[0], { name: 'community_save_post', args: { p_title: post.title, p_body: post.body, p_id: null } });
  assert.deepEqual(page.navigation, [`/board/post?id=${postId}`]);
});

test('failed save preserves the draft and enables retry', async () => {
  const page = await load('write-post.js', { rpc: async () => ({ data: null, error: { code: 'rate_limit' } }) });
  page.element('post-title').value = '제목';
  page.element('post-body').value = '작성하던 글';
  await page.element('write-form').listeners.submit({ preventDefault() {} });
  assert.equal(page.element('write-fields').disabled, false);
  assert.equal(page.element('post-body').value, '작성하던 글');
  assert.equal(page.element('write-message').isError, true);
  assert.equal(page.navigation.length, 0);
});

test('anonymous readers see plain text detail and cannot trigger delete', async () => {
  const page = await load('post.js', { search: `?id=${postId}`, user: null, rpc: async () => ({ data: post, error: null }) });
  assert.equal(page.element('post-article').hidden, false);
  assert.equal(page.element('post-content').textContent, post.body);
  assert.equal(page.element('post-content').children.length, 0);
  assert.equal(page.element('post-owner-actions').hidden, true);
  assert.equal(page.element('post-join').hidden, false);
  await page.element('post-delete').listeners.click();
  assert.equal(page.calls.length, 1);
});

test('owner confirms deletion before the RPC and returns to the list on success', async () => {
  let confirmed = false;
  const page = await load('post.js', {
    search: `?id=${postId}`, confirm: () => confirmed,
    rpc: async (name) => ({ data: name === 'community_delete_post' ? true : post, error: null }),
  });
  assert.equal(page.element('post-owner-actions').hidden, false);
  await page.element('post-delete').listeners.click();
  assert.equal(page.calls.length, 1);
  confirmed = true;
  await page.element('post-delete').listeners.click();
  assert.deepEqual(page.calls[1], { name: 'community_delete_post', args: { p_id: postId } });
  assert.deepEqual(page.navigation, ['/board']);
});

test('malformed post IDs never reach the database', async () => {
  for (const file of ['post.js', 'write-post.js']) {
    const page = await load(file, { search: '?id=%3Cscript%3E' });
    assert.equal(page.calls.length, 0);
    assert.equal(page.element(file === 'post.js' ? 'post-message' : 'write-message').isError, true);
  }
});
