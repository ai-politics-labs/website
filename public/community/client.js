import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://bsiatqjivenmblkcujjw.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzaWF0cWppdmVubWJsa2N1amp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODk2OTMsImV4cCI6MjA4ODM2NTY5M30.ReRm1mteN7bsWiRoMhHc8EfhLncJuLZ_8hSR-El8-S4';
export const supabase = createClient(SUPABASE_URL, ANON_KEY);

export function safeNext(value, origin = location.origin) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/account';
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.pathname.startsWith('//') ? url.pathname + url.search + url.hash : '/account';
  } catch { return '/account'; }
}

export function authError(error) {
  const code = error?.code || '';
  const message = error?.message || '';
  if (/invalid_credentials|invalid login/i.test(code + message)) return '이메일 또는 비밀번호를 확인해 주세요.';
  if (/email_not_confirmed|email not confirmed/i.test(code + message)) return '가입 인증 메일을 먼저 확인해 주세요.';
  if (/rate|too many|over_.*limit/i.test(code + message)) return '요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.';
  if (/username|아이디|duplicate key/i.test(message)) return '이미 사용 중이거나 사용할 수 없는 아이디입니다.';
  if (/referrer|추천인/i.test(message)) return '추천인 아이디를 확인해 주세요.';
  if (/weak_password|password.*(short|length)/i.test(code + message)) return '비밀번호는 10자 이상으로 입력해 주세요.';
  if (/same_password/i.test(code)) return '기존과 다른 비밀번호를 입력해 주세요.';
  if (/not.*authenticated|not.*verified|인증/i.test(message)) return '로그인과 이메일 인증을 완료한 뒤 다시 시도해 주세요.';
  if (/not.*owner|forbidden|permission|권한/i.test(message)) return '이 작업을 할 수 있는 권한이 없습니다.';
  if (/fetch|network/i.test(message)) return '연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  return '요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export async function requireUser(next = '/account') {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    location.assign('/auth?next=' + encodeURIComponent(safeNext(next)));
    return null;
  }
  return data.user;
}

export async function getProfile() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const result = await supabase.from('community_profiles').select('user_id,username,display_name,created_at').eq('user_id', user.id).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

export function setMessage(element, text, isError = false) {
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle('is-error', isError);
  element.setAttribute('role', isError ? 'alert' : 'status');
}
