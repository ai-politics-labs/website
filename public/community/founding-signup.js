const USERNAME = /^[a-z][a-z0-9_]{2,23}$/;

function signupError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function foundingSignupError(error) {
  const details = `${error?.code || ''} ${error?.message || ''}`;
  if (/login_required|AUTH_REQUIRED/i.test(details)) return '먼저 카카오나 Google로 로그인해 주세요. 로그인한 뒤 이 동의서를 제출할 수 있습니다.';
  if (/verification_required/i.test(details)) return '이메일이 확인된 카카오 또는 Google 계정으로 로그인해 주세요.';
  if (/SELF_REFERRAL/i.test(details)) return '내 아이디는 추천인으로 입력할 수 없습니다. 비워 두고 참여할 수 있습니다.';
  if (/referrer|추천인/i.test(details)) return '추천인 아이디를 확인해 주세요. 영문 소문자로 입력하거나 비워 두고 참여할 수 있습니다.';
  if (/rate|too many|limit/i.test(details)) return '요청이 잠시 많습니다. 입력한 내용은 유지되니 잠시 후 다시 시도해 주세요.';
  if (/fetch|network|connection/i.test(details)) return '연결하지 못했습니다. 입력한 내용은 유지되니 인터넷 연결을 확인하고 다시 시도해 주세요.';
  return '신청을 완료하지 못했습니다. 입력한 내용은 유지되니 잠시 후 다시 시도해 주세요.';
}

// Accounts come from Kakao or Google sign-in, so this only submits the consent
// of the signed-in member. Founder data never enters auth metadata or storage.
export function createFoundingSignup(supabase, { referralData }) {
  return async function submitFoundingSignup({ referrerUsername = '', founder }) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError && !/AuthSessionMissingError|session.*missing|session_not_found/i.test(`${userError.name || ''} ${userError.code || ''} ${userError.message || ''}`)) throw userError;
    if (!userData?.user) throw signupError('login_required');
    if (!userData.user.email_confirmed_at) throw signupError('verification_required');

    referrerUsername = referrerUsername.trim().toLowerCase();
    if (referrerUsername) {
      if (!USERNAME.test(referrerUsername)) throw signupError('invalid_referrer');
      const { data, error } = await supabase.rpc('community_referrer_exists', { p_username: referrerUsername });
      if (error) throw error;
      if (data !== true) throw signupError('invalid_referrer');
    }

    const { data, error } = await supabase.rpc('community_submit_founding_consent_referred', {
      p_founder: founder,
      p_referrer_username: referrerUsername || null,
      p_visitor_id: referralData().visitor_id || null,
    });
    if (error) throw error;
    if (!data?.id) throw signupError('submission_failed');
    return { kind: 'existing', alreadyRegistered: data.already_registered === true };
  };
}
