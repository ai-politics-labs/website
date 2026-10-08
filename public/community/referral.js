// Browser identifiers measure reach, not unique people. No IP, fingerprint or contact data.
const STORAGE_KEY = 'aip_referral_v1';
const VISITOR_KEY = 'aip_visitor_v1';
const TTL = 30 * 24 * 60 * 60 * 1000;
const USERNAME = /^[a-z][a-z0-9_]{2,23}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let memory;
let visitorMemory;

export function readReferralUrl(url) {
  const referrer = (url.searchParams.get('ref') || '').toLowerCase().trim();
  const slug = url.searchParams.get('link') || '';
  if (!USERNAME.test(referrer) || (slug && !/^[a-zA-Z0-9_-]{8,64}$/.test(slug))) return null;
  return { referrer, slug };
}

function visitorId() {
  if (visitorMemory) return visitorMemory;
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored && UUID.test(stored)) return visitorMemory = stored;
  } catch { /* In-memory identifier still permits this page's attribution. */ }
  visitorMemory = crypto.randomUUID();
  try { localStorage.setItem(VISITOR_KEY, visitorMemory); } catch { /* Storage may be blocked. */ }
  return visitorMemory;
}

export function getReferral() {
  let value = memory;
  try { value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || value; } catch { /* Keep in-memory first touch. */ }
  if (!value || !USERNAME.test(value.referrer) || !UUID.test(value.visitorId) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
  return value;
}

export function signupReferralData() { return { visitor_id: getReferral()?.visitorId || visitorId() }; }

export async function captureReferral() {
  const incoming = readReferralUrl(new URL(location.href));
  if (!incoming) return;
  const id = visitorId();
  try {
    const { supabase } = await import('./client.js');
    const { data, error } = await supabase.rpc('community_track_visit', {
      p_referrer: incoming.referrer, p_link_slug: incoming.slug || null, p_visitor_id: id,
    });
    if (error || data !== true) return;
    // Every valid link can count a visit; only the first one wins attribution until expiry.
    if (!getReferral()) {
      memory = { ...incoming, visitorId: id, expiresAt: Date.now() + TTL };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)); } catch { /* Server keeps authoritative first touch. */ }
    }
  } catch { /* Tracking failure must not block landing pages or signup. */ }
}

export function buildReferralUrl(profile, link = null) {
  const url = new URL('https://aiparty.kr/');
  url.searchParams.set('ref', profile.username);
  if (link) {
    url.searchParams.set('link', link.slug);
    url.searchParams.set('utm_source', link.source);
    url.searchParams.set('utm_medium', link.medium);
    url.searchParams.set('utm_campaign', link.campaign);
  }
  return url.toString();
}
