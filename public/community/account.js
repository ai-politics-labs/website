import { supabase, requireUser, getProfile, authError, el, setMessage } from './client.js';
import { buildReferralUrl } from './referral.js';

const message = document.getElementById('account-message');
const statsMessage = document.getElementById('referral-stats-message');
const number = new Intl.NumberFormat('ko-KR');
let profile;

async function copyLink(value) {
  try { await navigator.clipboard.writeText(value); setMessage(message, '초대 링크를 복사했습니다.'); }
  catch { setMessage(message, '복사하지 못했습니다. 링크를 직접 선택해서 복사해 주세요.', true); }
}

async function loadStats() {
  const refresh = document.getElementById('refresh-referrals');
  refresh.disabled = true;
  setMessage(statsMessage, '추천 현황을 불러오는 중입니다.');
  try {
    const { data, error } = await supabase.rpc('community_my_referrals');
    if (error || !data || !Array.isArray(data.links)) throw error || new Error('Invalid statistics');
    document.getElementById('referral-visitors').textContent = number.format(data.visitors);
    document.getElementById('referral-signups').textContent = number.format(data.signups);
    document.getElementById('referral-manual').textContent = number.format(data.manual_signups);
    const list = document.getElementById('campaign-list');
    list.replaceChildren();
    if (!data.links.length) list.append(el('p', 'c-empty', '아직 만든 채널별 링크가 없습니다. 첫 초대 링크를 만들어 보세요.'));
    for (const link of data.links) {
      const row = el('article', 'campaign-row');
      row.append(el('h3', 'campaign-title', link.campaign));
      const meta = el('div', 'campaign-meta');
      meta.append(el('span', '', `${link.source} / ${link.medium}`), el('span', '', `방문 ${number.format(link.visitors)} · 가입 ${number.format(link.signups)}`));
      const url = buildReferralUrl(profile, link);
      const linkText = el('p', 'campaign-url', url);
      const actions = el('div', 'c-actions');
      const copy = el('button', 'c-button c-button-secondary', '링크 복사');
      copy.type = 'button';
      copy.addEventListener('click', () => copyLink(url));
      actions.append(copy);
      if (navigator.share) {
        const share = el('button', 'c-button c-button-secondary', '공유하기');
        share.type = 'button';
        share.addEventListener('click', async () => { try { await navigator.share({ title: 'AIP · AI Party', text: '새로운 시작을 함께 만들어 주세요.', url }); } catch (error) { if (error.name !== 'AbortError') setMessage(message, '공유하지 못했습니다. 링크 복사를 이용해 주세요.', true); } });
        actions.append(share);
      }
      row.append(meta, linkText, actions);
      list.append(row);
    }
    setMessage(statsMessage, '');
    return true;
  } catch (error) {
    setMessage(statsMessage, '추천 현황을 불러오지 못했습니다. 새로고침해 주세요.', true);
    return false;
  }
  finally { refresh.disabled = false; }
}

async function showAccount() {
  profile = await getProfile();
  if (!profile) { document.getElementById('complete-profile').hidden = false; return; }
  document.getElementById('complete-profile').hidden = true;
  document.getElementById('account-content').hidden = false;
  document.getElementById('profile-label').textContent = `${profile.display_name} · @${profile.username}`;
  document.getElementById('referrer-id').textContent = profile.username;
  document.getElementById('default-referral').value = buildReferralUrl(profile);
  await loadStats();
}

document.getElementById('account-logout').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) { setMessage(message, authError(error), true); return; }
  location.assign('/auth');
});
document.getElementById('copy-default').addEventListener('click', () => copyLink(document.getElementById('default-referral').value));
document.getElementById('refresh-referrals').addEventListener('click', loadStats);
document.getElementById('profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    const { error } = await supabase.rpc('community_complete_profile', { p_username: document.getElementById('profile-username').value.trim().toLowerCase(), p_display_name: document.getElementById('profile-name').value.trim() });
    if (error) throw error;
    await showAccount();
  } catch (error) { setMessage(message, authError(error), true); }
  finally { button.disabled = false; }
});
document.getElementById('link-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    const { error } = await supabase.rpc('community_create_link', { p_source: document.getElementById('utm-source').value.trim(), p_medium: document.getElementById('utm-medium').value.trim(), p_campaign: document.getElementById('utm-campaign').value.trim() });
    if (error) throw error;
    const refreshed = await loadStats();
    setMessage(message, refreshed
      ? '새 초대 링크를 만들었습니다. 아래에서 복사해 공유하세요.'
      : '새 초대 링크를 만들었습니다.');
  } catch (error) { setMessage(message, authError(error), true); }
  finally { button.disabled = false; }
});
document.getElementById('request-deletion').addEventListener('click', async () => {
  const { error } = await supabase.rpc('community_request_deletion');
  setMessage(message, error ? authError(error) : '계정 삭제 요청을 접수했습니다. 운영자가 계정과 연결된 정보를 확인한 뒤 처리합니다.', !!error);
});

try {
  const user = await requireUser('/account');
  if (user) {
    if (!user.email_confirmed_at) setMessage(message, '이메일 인증을 완료해야 초대 링크와 추천 현황을 이용할 수 있습니다.', true);
    else await showAccount();
  }
} catch (error) { setMessage(message, authError(error), true); }
