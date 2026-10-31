import { matchedData } from 'express-validator';
import { sequelize, User, PasswordReset } from '../models/index.js';
import AppError from '../utils/AppError.js';
import {
  issueOtp,
  verifyOtp,
  discardToken,
  issueSessionToken,
  findValidToken,
  consumeUserTokens,
  OTP_TTL_MS,
  RESEND_COOLDOWN_SECONDS,
} from '../services/authTokenService.js';
import { ensureEmailDeliverable, sendPasswordResetOtpEmail } from '../services/emailService.js';

const PURPOSE = 'password_reset';
const OTP_TTL_TEXT = '10 minutes';
const OTP_SCOPE = { kind: 'otp' };
const SESSION_SCOPE = { kind: 'session' };

const GENERIC_MESSAGE = 'If an account exists for this email, a password reset code has been sent.';
// Same answer for unknown emails, wrong codes and expired codes: nothing reveals whether an account exists
const INVALID_CODE_MESSAGE = 'Invalid or expired code. Check the code or request a new one.';
const INVALID_TOKEN_MESSAGE = 'Invalid or expired password reset session. Please request a new code.';

// POST /api/auth/forgot-password { email } (same response for registered and unregistered emails)
export const forgotPassword = async (req, res) => {
  const { email } = matchedData(req);

  // Checked for every request, before looking up the account: when SMTP is unusable everyone gets
  // the same 502/503 (no false "code sent" message, and no hint about which emails are registered)
  await ensureEmailDeliverable();

  const user = await User.findOne({ where: { email, is_active: true } });
  if (user) {
    try {
      const { otp, record } = await issueOtp(PasswordReset, { userId: user.id, purpose: PURPOSE, scope: OTP_SCOPE });
      try {
        await sendPasswordResetOtpEmail(user, otp, OTP_TTL_TEXT);
      } catch (error) {
        await discardToken(record);
        throw error;
      }
    } catch (error) {
      // A cooldown, or a rare per-message failure after a healthy SMTP check, is logged but not
      // revealed (it would confirm the account exists). sendEmail already logged the delivery failure.
      if (!(error instanceof AppError)) throw error;
    }
  }

  res.status(200).json({
    success: true,
    message: GENERIC_MESSAGE,
    expires_in_seconds: OTP_TTL_MS / 1000,
    resend_after_seconds: RESEND_COOLDOWN_SECONDS,
  });
};

// POST /api/auth/verify-reset-otp { email, otp } -> single-use reset token (10 minutes)
export const verifyResetOtp = async (req, res) => {
  const { email, otp } = matchedData(req);

  const user = await User.findOne({ where: { email, is_active: true }, attributes: ['id'] });
  if (!user) {
    throw new AppError(INVALID_CODE_MESSAGE, 400);
  }

  // A correct code is consumed and exchanged for a reset session token in the same transaction
  const result = await verifyOtp(PasswordReset, {
    userId: user.id,
    purpose: PURPOSE,
    otp,
    scope: OTP_SCOPE,
    onValid: (transaction) => issueSessionToken(PasswordReset, { userId: user.id, scope: SESSION_SCOPE }, transaction),
  });

  if (result.status !== 'valid') {
    throw new AppError(INVALID_CODE_MESSAGE, 400);
  }

  res.status(200).json({ success: true, message: 'Code verified', reset_token: result.token, expires_at: result.expiresAt });
};

// POST /api/auth/verify-reset-token { token } (checks the reset session before showing the form)
export const verifyResetToken = async (req, res) => {
  const { token } = matchedData(req);

  const record = await findValidToken(PasswordReset, token, { scope: SESSION_SCOPE });
  if (!record) {
    throw new AppError(INVALID_TOKEN_MESSAGE, 400);
  }

  res.status(200).json({ success: true, valid: true, expires_at: record.expires_at });
};

// POST /api/auth/reset-password { token, password } (token from verify-reset-otp)
export const resetPassword = async (req, res) => {
  const { token, password } = matchedData(req);

  await sequelize.transaction(async (transaction) => {
    const record = await findValidToken(PasswordReset, token, { scope: SESSION_SCOPE, transaction });
    if (!record) {
      throw new AppError(INVALID_TOKEN_MESSAGE, 400);
    }

    const user = await User.findByPk(record.user_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user || !user.is_active) {
      throw new AppError(INVALID_TOKEN_MESSAGE, 400);
    }

    // The model hook hashes the password (bcrypt) and sets password_changed_at,
    // which invalidates every JWT issued before this moment.
    user.password = password;
    // The emailed code proves ownership of the address
    user.is_email_verified = true;
    await user.save({ transaction });

    // The session token, any code and every other outstanding reset record are invalidated
    await consumeUserTokens(PasswordReset, user.id, transaction);
  });

  res.status(200).json({
    success: true,
    message: 'Password reset successfully. Please log in with your new password.',
  });
};
