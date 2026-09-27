// Text messages through Twilio (optional). Turned on in Setup → Email & texts.
const fs = require('fs');
const path = require('path');

function isConfigured(s) {
  if (process.env.SMS_CAPTURE_DIR) return true;
  return s.smsEnabled === 'true' && Boolean(s.twilioSid && s.twilioToken && s.twilioFrom);
}

// US-friendly: 10 digits -> +1XXXXXXXXXX. Returns null if it doesn't look like a phone number.
function toE164(phone) {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+') && d.length >= 11) return d;
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

async function sendSms(settings, { to, body }) {
  const num = toE164(to);
  if (!num) { const e = new Error(`"${to}" isn't a valid mobile number.`); e.status = 400; throw e; }
  // Test mode: write messages to a folder instead of sending.
  if (process.env.SMS_CAPTURE_DIR) {
    fs.mkdirSync(process.env.SMS_CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.SMS_CAPTURE_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`), JSON.stringify({ to: num, body }, null, 2));
    return { sid: 'captured' };
  }
  if (!isConfigured(settings)) { const e = new Error('Texting is not set up. An admin can add it under Setup → Email & texts.'); e.status = 400; throw e; }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(settings.twilioSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${settings.twilioSid}:${settings.twilioToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: num, From: settings.twilioFrom, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`Text not sent: ${data.message || res.status}`); e.status = 400; throw e; }
  return data;
}

module.exports = { sendSms, isConfigured, toE164 };
