// Sends a message to a customer by email and/or text, honoring their preferences.
const { sendMail, isConfigured: emailReady } = require('./mailer');
const { sendSms, isConfigured: smsReady, toE164 } = require('./sms');

// Public base URL for links in messages (saved automatically from the first admin visit).
function baseUrl(settings) {
  return (process.env.PUBLIC_URL || settings.publicUrl || '').replace(/\/+$/, '');
}

function channelsFor(customer, settings, { requireSmsConsent = true } = {}) {
  const out = [];
  if (customer.email && emailReady(settings)) out.push('email');
  if (customer.phone && toE164(customer.phone) && smsReady(settings) && (!requireSmsConsent || customer.sms_ok)) out.push('sms');
  return out;
}

module.exports = { baseUrl, channelsFor, sendMail, sendSms, emailReady, smsReady };
