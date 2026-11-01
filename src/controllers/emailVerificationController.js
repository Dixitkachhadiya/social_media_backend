import { matchedData } from 'express-validator';
import { User, EmailVerification } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { maskEmail } from '../utils/otp.js';
import { issueOtp, verifyOtp, discardToken, OTP_TTL_MS, OTP_TTL_TEXT, RESEND_COOLDOWN_SECONDS } from '../services/authTokenService.js';
import { ensureEmailDeliverable, sendVerificationOtpEmail } from '../services/emailService.js';

const PURPOSE = 'email_verification';

const GENERIC_RESEND_MESSAGE =
  'If an unverified account exists for this email, a verification code has been sent.';

// Issues a code and emails it. Nothing is issued while SMTP is unusable, and a code whose
// email failed is discarded (so no OTP flow exists without a delivered email, and a retry is possible at once).
const sendCode = async (user) => {
  await ensureEmailDeliverable();
  const { otp, record } = await issueOtp(EmailVerification, { userId: user.id, purpose: PURPOSE });
  try {
    return await sendVerificationOtpEmail(user, otp, OTP_TTL_TEXT);
  } catch (error) {
    await discardToken(record);
    throw error;
  }
};

// POST /api/auth/send-verification (authenticated: a code is only ever sent to your own address)
export const sendVerification = async (req, res) => {
  const user = req.user;
  if (user.is_email_verified) {
    throw new AppError('Email is already verified', 400);
  }

  // Only reached when the SMTP server accepted the email (otherwise sendCode throws 502/503)
  await sendCode(user);

  res.status(200).json({
    success: true,
    message: 'A verification code has been sent to your email address.',
    email_delivered: true,
    email: maskEmail(user.email),
    expires_in_seconds: OTP_TTL_MS / 1000,
    resend_after_seconds: RESEND_COOLDOWN_SECONDS,
  });
};

// POST /api/auth/resend-verification (public; same response whether or not the account exists)
export const resendVerification = async (req, res) => {
  const { email } = matchedData(req);

  // Checked for every request, before looking up the account: an email outage is reported
  // without revealing whether the address is registered
  await ensureEmailDeliverable();

  const user = await User.findOne({ where: { email, is_active: true, is_email_verified: false } });
  if (user) {
    try {
      await sendCode(user);
    } catch (error) {
      // Cooldown or delivery problems are not revealed, to avoid account enumeration
      if (!(error instanceof AppError)) throw error;
      if (error.statusCode !== 429) console.error(`[email] Resend verification failed: ${error.message}`);
    }
  }

  res.status(200).json({ success: true, message: GENERIC_RESEND_MESSAGE });
};

// POST /api/auth/verify-email { otp } (authenticated: verifies the JWT user's own address only)
export const verifyEmail = async (req, res) => {
  const { otp } = matchedData(req);
  const user = req.user;

  if (user.is_email_verified) {
    throw new AppError('Email is already verified', 400);
  }

  const result = await verifyOtp(EmailVerification, {
    userId: user.id,
    purpose: PURPOSE,
    otp,
    onValid: (transaction) => User.update({ is_email_verified: true }, { where: { id: user.id }, transaction }),
  });

  if (result.status === 'invalid') {
    const error = new AppError(
      result.attemptsRemaining > 0
        ? `Incorrect verification code. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.`
        : 'Incorrect verification code. Too many attempts: request a new code.',
      400,
    );
    error.errors = [{ field: 'otp', message: 'Incorrect verification code' }];
    throw error;
  }
  if (result.status === 'expired') {
    throw new AppError('This verification code has expired or is no longer valid. Request a new code.', 400);
  }

  res.status(200).json({ success: true, message: 'Email verified successfully' });
};
