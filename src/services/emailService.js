import nodemailer from 'nodemailer';
import AppError from '../utils/AppError.js';
import { maskEmail } from '../utils/otp.js';

let transporter;

// SMTP_HOST may be omitted for a Gmail account: SMTP_USER=<address>@gmail.com then means smtp.gmail.com
// (port 587, STARTTLS). Any other provider needs SMTP_HOST (and usually SMTP_PORT).
const isGmailAddress = (value) => /@(gmail|googlemail)\.com$/i.test((value || '').trim());
const smtpHost = () => process.env.SMTP_HOST || (isGmailAddress(process.env.SMTP_USER) ? 'smtp.gmail.com' : '');
const smtpPort = () => Number(process.env.SMTP_PORT) || 587;

// With BREVO_API_KEY set, email goes through Brevo's HTTPS API (port 443) instead of SMTP. Needed where outbound
// SMTP is blocked, e.g. free Render web services (ports 25/465/587). The sender in EMAIL_FROM must be verified in Brevo.
const useBrevo = () => Boolean(process.env.BREVO_API_KEY);
const BREVO_API = 'https://api.brevo.com/v3';

// SMTP_USER/SMTP_PASS are optional for servers without authentication
export const isEmailConfigured = () => Boolean((useBrevo() || smtpHost()) && process.env.EMAIL_FROM);

// "Circlo <app@gmail.com>" -> { name: 'Circlo', email: 'app@gmail.com' }
const parseAddress = (value) => {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value || '');
  return match ? { name: match[1].trim() || undefined, email: match[2].trim() } : { email: (value || '').trim() };
};

const brevoError = (status, body) => {
  const error = new Error(`Brevo API responded ${status}${body?.code ? ` ${body.code}` : ''}${body?.message ? `: ${body.message}` : ''}`);
  // Rejected API key: reported like an SMTP login failure (EAUTH)
  error.code = status === 401 || status === 403 || /unauthori[sz]ed|api-key|authentication/i.test(body?.code || '') ? 'EAUTH' : 'EBREVO';
  error.responseCode = status;
  return error;
};

const brevoRequest = async (path, { method = 'GET', body } = {}) => {
  let response;
  try {
    response = await fetch(`${BREVO_API}${path}`, {
      method,
      headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json', ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw Object.assign(new Error(`Brevo API not reachable (${error.name === 'TimeoutError' ? 'timeout' : error.cause?.code || error.message})`), { code: 'ECONNECTION' });
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) throw brevoError(response.status, json);
  return json;
};

// Same interface as a Nodemailer transporter (verify, sendMail), so the rest of this module is unchanged
const brevoTransport = {
  verify: () => brevoRequest('/account').then(() => true),
  sendMail: async ({ from, to, subject, text, html }) => {
    const result = await brevoRequest('/smtp/email', {
      method: 'POST',
      body: { sender: parseAddress(from), to: [{ email: to }], subject, htmlContent: html, textContent: text },
    });
    return { accepted: [to], rejected: [], messageId: result?.messageId };
  },
};

// Google shows App Passwords as "abcd efgh ijkl mnop"; the real password has no spaces
const smtpPassword = () => {
  const pass = process.env.SMTP_PASS || '';
  return /(^|\.)gmail\.com$/i.test(smtpHost()) ? pass.replace(/\s+/g, '') : pass;
};

// Created lazily, after env.js has loaded Backend/.env; a restart picks up new .env values
const getTransporter = () => {
  if (!transporter && useBrevo()) transporter = brevoTransport;
  if (!transporter) {
    const port = smtpPort();
    transporter = nodemailer.createTransport({
      host: smtpHost(),
      port,
      // 465: implicit TLS. Any other port (e.g. Gmail's 587): secure=false + STARTTLS required, never plain text.
      secure: port === 465,
      requireTLS: port !== 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER.trim(), pass: smtpPassword() } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
};

// ---------- SMTP health (transporter.verify) ----------

// Successful checks are trusted for 5 minutes; failures are re-checked after 30 seconds
const HEALTHY_TTL_MS = 5 * 60 * 1000;
const UNHEALTHY_TTL_MS = 30 * 1000;
let health = { ok: null, checkedAt: 0, error: null };

// Success messages are skipped in automated tests; failures are always logged
const logInfo = (message) => process.env.NODE_ENV !== 'test' && console.log(message);

const isAuthError = (error) => error?.code === 'EAUTH' || error?.responseCode === 535 || error?.responseCode === 534;

// Safe one-line description of an SMTP error (codes and server reply only, never credentials)
const describeSmtpError = (error) =>
  [error.code, error.responseCode, error.command && `during ${error.command}`, error.message].filter(Boolean).join(' ');

const deliveryError = (error) => {
  // Development only: say *why*, so a misconfigured .env is obvious. Production stays generic.
  const hint =
    process.env.NODE_ENV === 'development' && !process.env.RENDER && isAuthError(error)
      ? useBrevo()
        ? ' (development: Brevo rejected BREVO_API_KEY.)'
        : ' (development: the SMTP server rejected SMTP_USER/SMTP_PASS. For Gmail, SMTP_PASS must be an App Password.)'
      : '';
  return new AppError(`Could not send email. Please try again later.${hint}`, 502);
};

/**
 * Tests the SMTP connection and login with transporter.verify().
 * Returns { ok, error } and logs a clear, credential-free result.
 */
export const verifySmtpConnection = async () => {
  if (!isEmailConfigured()) {
    health = { ok: false, checkedAt: Date.now(), error: null };
    console.error('[email] Email is not configured (EMAIL_FROM, or BREVO_API_KEY / SMTP_HOST for a non-Gmail SMTP_USER, is missing). Verification and password reset emails cannot be sent.');
    return { ok: false, error: null };
  }
  try {
    await getTransporter().verify();
    health = { ok: true, checkedAt: Date.now(), error: null };
    logInfo(`[email] ${useBrevo() ? 'Brevo API connection successful (HTTPS)' : `SMTP connection successful (${smtpHost()}:${smtpPort()})`}`);
    return { ok: true, error: null };
  } catch (error) {
    health = { ok: false, checkedAt: Date.now(), error };
    console.error(`[email] ${useBrevo() ? 'Brevo API' : 'SMTP'} connection failed: ${describeSmtpError(error)}`);
    if (useBrevo()) {
      if (isAuthError(error)) console.error('[email] Brevo rejected the API key. Check BREVO_API_KEY (Brevo: SMTP & API -> API keys).');
    } else if (isAuthError(error)) {
      console.error('[email] The SMTP server rejected the login. For Gmail use the full address as SMTP_USER and a 16-letter App Password as SMTP_PASS.');
    } else if (process.env.RENDER && ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(error.code)) {
      console.error('[email] The SMTP server could not be reached from Render. Free Render web services block outbound SMTP ports 25, 465 and 587: use a paid instance or an email API over HTTPS.');
    }
    return { ok: false, error };
  }
};

/**
 * Throws unless email can actually be delivered: 503 when SMTP is not configured,
 * 502 when the SMTP connection/login fails. Called BEFORE a code is issued, so no OTP
 * flow is started when the email cannot be sent. Account-independent, so calling it in
 * public endpoints reveals nothing about which emails are registered.
 */
export const ensureEmailDeliverable = async () => {
  if (!isEmailConfigured()) {
    throw new AppError('Email service is not configured. Please try again later.', 503);
  }
  const ttl = health.ok ? HEALTHY_TTL_MS : UNHEALTHY_TTL_MS;
  if (health.ok === null || Date.now() - health.checkedAt > ttl) {
    await verifySmtpConnection();
  }
  if (!health.ok) throw deliveryError(health.error);
};

/**
 * Test seam: replaces the SMTP transport (a mock with verify() and sendMail()).
 * Pass null to go back to the real transport. Resets the cached health check.
 */
export const setEmailTransporter = (mock) => {
  transporter = mock;
  health = { ok: null, checkedAt: 0, error: null };
};

// ---------- sending ----------

/**
 * Sends an email through SMTP. There is no fallback: an email is only reported as delivered when
 * the SMTP server accepted the recipient. Failures throw (503 not configured, 502 delivery failed).
 * `label` names the email in logs (e.g. "Verification email"); bodies are never logged.
 */
export const sendEmail = async ({ to, subject, text, html, label = 'Email' }) => {
  if (!isEmailConfigured()) {
    throw new AppError('Email service is not configured. Please try again later.', 503);
  }

  let info;
  try {
    info = await getTransporter().sendMail({ from: process.env.EMAIL_FROM, to, subject, text, html });
  } catch (error) {
    if (isAuthError(error)) health = { ok: false, checkedAt: Date.now(), error };
    console.error(`[email] ${label} delivery failed to ${maskEmail(to)}: ${describeSmtpError(error)}`);
    throw deliveryError(error);
  }

  const rejected = info?.rejected?.length ? info.rejected : [];
  const accepted = info?.accepted ?? [];
  if (rejected.length || !accepted.length) {
    console.error(`[email] ${label} delivery failed to ${maskEmail(to)}: recipient rejected by the SMTP server`);
    throw deliveryError(null);
  }

  logInfo(`[email] ${label} delivered successfully to ${maskEmail(to)}${info.messageId ? ` (${info.messageId})` : ''}`);
  return { delivered: true };
};

// Startup check (does not stop the server)
export const checkEmailTransport = async () => (await verifySmtpConnection()).ok;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BRAND = () => process.env.APP_NAME || 'AI-Powered Social Media Platform';
const NEVER_SHARE = 'Never share this code with anyone. We will never ask you for it.';

/**
 * Responsive, email-client-safe HTML (tables + inline styles) with a plain-text alternative.
 * Never contains passwords or JWTs: only the one-time code.
 */
const otpEmail = ({ preheader, heading, username, intro, otp, expiry, warning }) => {
  const brand = BRAND();
  const year = new Date().getFullYear();

  const text = [
    `${brand}`,
    '',
    `Hi ${username},`,
    '',
    intro,
    '',
    `Your code: ${otp}`,
    '',
    `This code expires in ${expiry} and can be used only once.`,
    NEVER_SHARE,
    warning,
    '',
    `© ${year} ${brand}. This is an automated message, please do not reply.`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f8fa;-webkit-text-size-adjust:100%;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f8fa;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 20px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:32px;height:32px;background:#4f46e5;border-radius:8px;text-align:center;vertical-align:middle;color:#ffffff;font-weight:700;font-size:16px;">${escapeHtml(brand.charAt(0))}</td>
              <td style="padding-left:10px;font-size:17px;font-weight:600;color:#0f172a;">${escapeHtml(brand)}</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:32px 28px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#334155;">
            <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;font-weight:600;">${escapeHtml(heading)}</h1>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Hi ${escapeHtml(username)},</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:#eef2ff;border:1px solid #e0e7ff;border-radius:12px;padding:20px 12px;">
                  <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#4338ca;font-weight:600;margin-bottom:8px;">Your code</div>
                  <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;line-height:1.2;font-weight:700;letter-spacing:10px;color:#0f172a;padding-left:10px;">${escapeHtml(otp)}</div>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:14px;line-height:1.6;">This code expires in <strong>${escapeHtml(expiry)}</strong> and can be used only once.</p>
            <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#b91c1c;font-weight:600;">${escapeHtml(NEVER_SHARE)}</p>
            <p style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-radius:8px;font-size:13px;line-height:1.6;color:#475569;">${escapeHtml(warning)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#64748b;text-align:center;">
            © ${year} ${escapeHtml(brand)}. This is an automated message, please do not reply.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { text, html };
};

export const sendVerificationOtpEmail = (user, otp, expiry) =>
  sendEmail({
    to: user.email,
    label: 'Verification email',
    subject: `Verify Your ${BRAND()} Account`,
    ...otpEmail({
      preheader: `Your ${BRAND()} verification code is ${otp}`,
      heading: 'Verify your email address',
      username: user.username,
      intro: `Use the code below to confirm the email address for your ${BRAND()} account.`,
      otp,
      expiry,
      warning: 'If you did not request this code, you can safely ignore this email.',
    }),
  });

export const sendPasswordResetOtpEmail = (user, otp, expiry) =>
  sendEmail({
    to: user.email,
    label: 'Password reset email',
    subject: `Reset Your ${BRAND()} Password`,
    ...otpEmail({
      preheader: `Your ${BRAND()} password reset code is ${otp}`,
      heading: 'Reset your password',
      username: user.username,
      intro: `We received a request to reset the password for your ${BRAND()} account. Enter this code to continue.`,
      otp,
      expiry,
      warning: 'If you did not request a password reset, do not share this code. Your password will stay the same.',
    }),
  });
