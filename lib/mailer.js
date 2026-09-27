// Sends email using the SMTP settings saved in Setup > Email.
const nodemailer = require('nodemailer');

function isConfigured(s) {
  return Boolean(s.smtpHost && s.smtpFrom);
}

async function sendMail(settings, { to, subject, text, attachments }) {
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
