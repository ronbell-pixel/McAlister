// Sends email using the SMTP settings saved in Setup > Email.
const nodemailer = require('nodemailer');

function isConfigured(s) {
  if (process.env.MAIL_CAPTURE_DIR) return true;
  return Boolean(s.smtpHost && s.smtpFrom);
}

async function sendMail(settings, { to, subject, text, attachments }) {
  // Test mode: write emails to a folder instead of sending.
  if (process.env.MAIL_CAPTURE_DIR) {
    const fs = require('fs'); const path = require('path');
    fs.mkdirSync(process.env.MAIL_CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.MAIL_CAPTURE_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`),
      JSON.stringify({ to, subject, text, attachments: (attachments || []).map((a) => a.filename) }, null, 2));
    return { messageId: 'captured' };
  }
  if (!isConfigured(settings)) {
    const err = new Error('Email is not set up yet. An admin can add mail server details under Setup → Email.');
    err.status = 400;
    throw err;
  }
  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: parseInt(settings.smtpPort || '587', 10),
    secure: settings.smtpSecure === 'true',
    auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPass } : undefined,
  });
  return transport.sendMail({
    from: settings.smtpFrom,
    replyTo: settings.email || undefined,
    to,
    subject,
    text,
    attachments,
  });
}

module.exports = { sendMail, isConfigured };
