import { supabase, el, setMessage } from './client.js';

const params = new URLSearchParams(window.location.search);
const rawPage = params.get('page') || '1';
const page = /^\d+$/.test(rawPage) ? Math.min(10000, Math.max(1, Number(rawPage))) : 1;
const query = (params.get('q') || '').trim().slice(0, 120);
const message = document.getElementById('board-message');
const results = document.getElementById('board-results');
const list = document.getElementById('board-list');
const count = document.getElementById('board-count');
const empty = document.getElementById('board-empty');
const pagination = document.getElementById('board-pagination');
const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
const dayFormat = new Intl.DateTimeFormat('ko-KR', { weekday: 'long', timeZone: 'Asia/Seoul' });
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' });

document.getElementById('board-query').value = query;
document.getElementById('board-clear').hidden = !query;

function pageUrl(target) {
  const search = new URLSearchParams();
  if (query) search.set('q', query);
  if (target > 1) search.set('page', String(target));
  return `/board${search.size ? `?${search}` : ''}`;
}

async function loadPosts() {
  try {
    const { data, error } = await supabase.rpc('community_list_posts', { p_page: page, p_query: query });
    if (error) throw error;
    if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.page) || data.page < 1) {
      throw new Error('Invalid posts response');
    }
    const pages = Math.max(1, Math.ceil(data.total / 20));
    if (data.page > pages) {
      window.location.replace(pageUrl(pages));
      return;
    }
    list.replaceChildren();
    for (const post of data.items.slice(0, 20)) {
      if (!post || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(post.id)) continue;
      const item = el('article', 'c-list-item');
      const date = new Date(post.created_at);
      const dateRail = el('time', 'board-date');
      if (!Number.isNaN(date.getTime())) {
        dateRail.dateTime = post.created_at;
        dateRail.append(el('span', 'board-date-label', dateFormat.format(date)));
        dateRail.append(el('span', 'board-date-day', dayFormat.format(date)));
      }
      item.append(dateRail);
      const link = el('a', 'board-post-link');
      link.href = `/board/post?id=${encodeURIComponent(post.id)}`;
      if (!Number.isNaN(date.getTime())) link.append(el('span', 'board-time', timeFormat.format(date)));
      link.append(el('h2', 'board-post-title', post.title || '제목 없음'));
      link.append(el('p', 'c-muted board-excerpt', post.excerpt || ''));
      const meta = el('div', 'c-meta c-muted');
      const authorMark = el('span', 'board-author-mark', Array.from(post.author_name || post.author_username || '회원')[0]);
      authorMark.setAttribute('aria-hidden', 'true');
      meta.append(authorMark);
      meta.append(el('span', '', `${post.author_name || post.author_username || '회원'}${post.author_username ? ` (@${post.author_username})` : ''}`));
      link.append(meta);
      item.append(link);
      list.append(item);
    }
    count.textContent = `${query ? '검색 결과' : '전체'} ${data.total.toLocaleString('ko-KR')}개의 글`;
    empty.hidden = data.items.length !== 0;
    if (query) {
      document.getElementById('board-empty-title').textContent = '검색 결과가 없습니다.';
      document.getElementById('board-empty-description').textContent = '다른 검색어로 다시 찾아보세요.';
      document.getElementById('board-empty-write').hidden = true;
    }
    pagination.hidden = pages <= 1;
    const prev = document.getElementById('board-prev');
    const next = document.getElementById('board-next');
    prev.hidden = data.page <= 1;
    next.hidden = data.page >= pages;
    prev.href = pageUrl(data.page - 1);
    next.href = pageUrl(data.page + 1);
    document.getElementById('board-page').textContent = `${data.page.toLocaleString('ko-KR')} / ${pages.toLocaleString('ko-KR')} 페이지`;
  } catch {
    count.textContent = '게시글을 불러오지 못했습니다.';
    setMessage(message, '게시판에 연결하지 못했습니다. 잠시 후 새로고침해 주세요.', true);
  } finally {
    results.setAttribute('aria-busy', 'false');
  }
}

loadPosts();
