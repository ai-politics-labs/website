import { supabase, authError, setMessage } from './client.js';

const params = new URLSearchParams(window.location.search);
const postId = params.get('id') || '';
const message = document.getElementById('post-message');
const ownerActions = document.getElementById('post-owner-actions');
const deleteButton = document.getElementById('post-delete');
let canManage = false;
let deleting = false;

async function loadPost() {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(postId)) {
    setMessage(message, '게시글 주소가 올바르지 않습니다. 게시판 목록에서 다시 선택해 주세요.', true);
    return;
  }
  try {
    const { data: post, error } = await supabase.rpc('community_get_post', { p_id: postId });
    if (error) throw error;
    if (!post) {
      setMessage(message, '게시글을 찾을 수 없습니다. 삭제되었거나 주소가 변경되었을 수 있습니다.', true);
      return;
    }
    document.getElementById('post-heading').textContent = post.title || '제목 없음';
    document.title = `${post.title || '게시글'} — AI정치연구소`;
    document.getElementById('post-author').textContent = `${post.author_name || post.author_username || '회원'}${post.author_username ? ` (@${post.author_username})` : ''}`;
    document.getElementById('post-content').textContent = post.body || '';
    const created = new Date(post.created_at);
    if (!Number.isNaN(created.getTime())) {
      const time = document.getElementById('post-created');
      time.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(created);
      time.dateTime = post.created_at;
    }
    document.getElementById('post-updated').hidden = !post.updated_at || post.updated_at === post.created_at;
    document.getElementById('post-article').hidden = false;
    message.hidden = true;
    // Public reading remains available even if an expired session cannot be refreshed.
    let user = null;
    try {
      const result = await supabase.auth.getUser();
      user = result.data?.user || null;
    } catch {}
    canManage = Boolean(user?.email_confirmed_at && user.id === post.author_id);
    ownerActions.hidden = !canManage;
    document.getElementById('post-edit').href = `/board/write?id=${encodeURIComponent(postId)}`;
    document.getElementById('post-join').hidden = Boolean(user);
  } catch {
    setMessage(message, '게시글을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.', true);
  }
}

deleteButton.addEventListener('click', async () => {
  if (!canManage || deleting) return;
  if (!window.confirm('이 글을 삭제할까요? 삭제하면 게시판에 표시되지 않습니다.')) return;
  deleting = true;
  deleteButton.disabled = true;
  deleteButton.textContent = '삭제하는 중…';
  try {
    const { data, error } = await supabase.rpc('community_delete_post', { p_id: postId });
    if (error) throw error;
    if (data !== true) throw new Error('Post not deleted');
    window.location.assign('/board');
  } catch (error) {
    setMessage(message, authError(error) || '게시글을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
    deleteButton.disabled = false;
    deleteButton.textContent = '삭제';
    deleting = false;
  }
});

loadPost();
