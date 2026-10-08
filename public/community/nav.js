import { supabase } from './client.js';
const link = document.querySelector('[data-community-auth]');
if (link) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { link.href = '/account'; link.textContent = '내 계정'; }
}
