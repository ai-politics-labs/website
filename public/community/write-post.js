import { supabase, requireUser, getProfile, authError, setMessage } from './client.js';

const params = new URLSearchParams(window.location.search);
const postId = params.get('id');
const message = document.getElementById('write-message');
const form = document.getElementById('write-form');
const fields = document.getElementById('write-fields');
const titleInput = document.getElementById('post-title');
const bodyInput = document.getElementById('post-body');
const submit = document.getElementById('write-submit');
let ready = false;
let saving = false;

function showAccess(text) {
  message.hidden = true;
  document.getElementById('write-access-message').textContent = text;
  document.getElementById('write-access').hidden = false;
}

async function initialize() {
  if (postId !== null && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(postId)) {
    setMessage(message, '게시글 주소가 올바르지 않습니다. 게시판 목록에서 다시 선택해 주세요.', true);
    return;
  }
  try {
    const next = `/board/write${postId ? `?id=${encodeURIComponent(postId)}` : ''}`;
    const user = await requireUser(next);
    if (!user) return;
    if (!user.email_confirmed_at) {
      showAccess('이메일 인증을 마치면 글을 쓸 수 있습니다. 가입한 이메일의 인증 링크를 확인해 주세요.');
      return;
    }
    const profile = await getProfile();
    if (!profile) {
      showAccess('글을 쓰기 전에 내 계정에서 아이디와 표시 이름을 등록해 주세요.');
      return;
    }
    if (postId) {
      const { data, error } = await supabase.rpc('community_get_post', { p_id: postId });
      if (error) throw error;
      if (!data) {
        setMessage(message, '게시글을 찾을 수 없습니다. 삭제되었거나 주소가 변경되었을 수 있습니다.', true);
        return;
      }
      if (data.author_id !== user.id) {
        setMessage(message, '자신이 작성한 게시글만 수정할 수 있습니다.', true);
        return;
      }
      document.getElementById('write-heading').textContent = '글 수정';
      document.title = '글 수정 — AI정치연구소';
      titleInput.value = data.title || '';
      bodyInput.value = data.body || '';
      submit.textContent = '수정 저장';
      document.getElementById('write-cancel').href = `/board/post?id=${encodeURIComponent(postId)}`;
    }
    ready = true;
    fields.disabled = false;
    form.hidden = false;
    message.hidden = true;
  } catch (error) {
    setMessage(message, authError(error) || '글쓰기 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!ready || saving) return;
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  if (!title || title.length > 120 || !body || body.length > 10000) {
    setMessage(message, '제목은 1~120자, 내용은 1~10,000자로 입력해 주세요.', true);
    (!title || title.length > 120 ? titleInput : bodyInput).focus();
    return;
  }
  saving = true;
  fields.disabled = true;
  submit.textContent = '저장하는 중…';
  setMessage(message, '게시글을 저장하고 있습니다.');
  try {
    const { data, error } = await supabase.rpc('community_save_post', { p_title: title, p_body: body, p_id: postId || null });
    if (error) throw error;
    if (typeof data !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(data)) throw new Error('Invalid post response');
    window.location.assign(`/board/post?id=${encodeURIComponent(data)}`);
  } catch (error) {
    setMessage(message, authError(error) || '게시글을 저장하지 못했습니다. 입력한 내용은 그대로 남아 있습니다.', true);
    fields.disabled = false;
    submit.textContent = postId ? '수정 저장' : '게시하기';
    saving = false;
  }
});

initialize();
