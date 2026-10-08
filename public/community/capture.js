import { captureReferral, getReferral } from './referral.js';
await captureReferral();
const invite = document.querySelector('[data-referral-invite]');
if (invite && getReferral()) invite.hidden = false;
