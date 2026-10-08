const USERNAME = /^[a-z][a-z0-9_]{2,23}$/;
const RESERVED = new Set(['admin', 'administrator', 'aip', 'aiparty', 'support', 'system', 'official', 'moderator', 'root']);

export function validFoundingUsername(value) {
  return USERNAME.test(value) && !RESERVED.has(value);
}

function signupError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function foundingSignupError(error) {
  const details = `${error?.code || ''} ${error?.message || ''}`;
  if (/existing_email|already_registered|email_exists|user_already_exists/i.test(details)) return '이미 가입한 이메일입니다. 로그인한 뒤 같은 발기인 동의서를 제출해 주세요. 입력하신 내용은 이 화면에 유지됩니다.';
  if (/verification_required/i.test(details)) return '가입 인증 메일의 링크를 먼저 열어 이메일 인증을 완료해 주세요. 로그인 화면에서 인증 메일을 다시 받을 수 있습니다.';
  if (/username|아이디|duplicate key/i.test(details)) return '이미 사용 중이거나 사용할 수 없는 아이디입니다. 다른 아이디를 입력해 주세요.';
  if (/referrer|추천인/i.test(details)) return '추천인 아이디를 확인해 주세요. 영문 소문자로 입력하거나 비워 두고 참여할 수 있습니다.';
  if (/weak_password|password/i.test(details)) return '비밀번호는 10자 이상으로 입력해 주세요.';
  if (/rate|too many|limit/i.test(details)) return '요청이 잠시 많습니다. 입력한 내용은 유지되니 잠시 후 다시 시도해 주세요.';
  if (/fetch|network|connection/i.test(details)) return '연결하지 못했습니다. 입력한 내용은 유지되니 인터넷 연결을 확인하고 다시 시도해 주세요.';
  return '신청을 완료하지 못했습니다. 입력한 내용은 유지되니 잠시 후 다시 시도해 주세요.';
}

// The draft and receipt stay in this page's memory. Founder data never enters auth metadata.
export function createFoundingSignup(supabase, { origin, referralData, now = Date.now }) {
  let pending = null;

  async function completed(token) {
    try {
      const { data, error } = await supabase.rpc('community_founding_signup_status', { p_token: token });
      return !error && data?.completed === true;
    } catch { return false; }
  }

  return async function submitFoundingSignup({ email, password, username, displayName, referrerUsername, founder }) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError && !/AuthSessionMissingError|session.*missing|session_not_found/i.test(`${userError.name || ''} ${userError.code || ''} ${userError.message || ''}`)) throw userError;
    if (userData?.user) {
      if (!userData.user.email_confirmed_at) throw signupError('verification_required');
      const { data, error } = await supabase.rpc('community_submit_founding_consent', { p_founder: founder });
      if (error) throw error;
      if (!data?.id) throw signupError('submission_failed');
      return { kind: 'existing', alreadyRegistered: data.already_registered === true };
    }

    email = email.trim().toLowerCase();
    username = username.trim().toLowerCase();
    referrerUsername = referrerUsername.trim().toLowerCase();
    if (!validFoundingUsername(username)) throw signupError('invalid_username');
    if (referrerUsername) {
      if (!USERNAME.test(referrerUsername) || referrerUsername === username) throw signupError('invalid_referrer');
      const { data, error } = await supabase.rpc('community_referrer_exists', { p_username: referrerUsername });
      if (error) throw error;
      if (data !== true) throw signupError('invalid_referrer');
    }

    // A previous request may have committed even when mail delivery or the network failed.
    if (pending && pending.email === email && await completed(pending.token)) {
      pending = null;
      return { kind: 'created', verificationRequired: true, recovered: true };
    }

    const prepare = {
      p_email: email,
      p_username: username,
      p_display_name: displayName.trim() || username,
      p_founder: founder,
      p_referrer_username: referrerUsername || null,
      p_visitor_id: referralData().visitor_id,
    };
    const fingerprint = JSON.stringify(prepare);
    if (!pending || pending.fingerprint !== fingerprint || now() - pending.createdAt >= 14 * 60 * 1000) {
      const { data, error } = await supabase.rpc('community_prepare_founding_signup', prepare);
      if (error) throw error;
      if (!data?.token) throw signupError('prepare_failed');
      pending = { email, token: data.token, fingerprint, createdAt: now() };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: new URL('/auth?mode=callback', origin).href,
          data: { community_signup: true, founding_signup_token: pending.token, privacy_version: '2026-10-09' },
        },
      });
      if (error) throw error;
      if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) throw signupError('existing_email');
      if (!data?.user?.id) throw signupError('signup_failed');
      const verificationRequired = !data.session || !data.user.email_confirmed_at;
      pending = null;
      return { kind: 'created', verificationRequired };
    } catch (error) {
      if (await completed(pending.token)) {
        pending = null;
        return { kind: 'created', verificationRequired: true, recovered: true };
      }
      throw error;
    }
  };
}
