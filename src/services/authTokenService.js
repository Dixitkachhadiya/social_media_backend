import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { sequelize } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { generateSecureToken, hashToken } from '../utils/secureToken.js';
import { generateOtp, hashOtp, otpMatches } from '../utils/otp.js';

// Minimum time between two codes of the same kind for one user
export const RESEND_COOLDOWN_SECONDS = 60;
// OTP codes are valid for 10 minutes
export const OTP_TTL_MS = 10 * 60 * 1000;
// Incorrect guesses allowed per code before it is invalidated
export const MAX_OTP_ATTEMPTS = 5;

const unexpired = () => ({ used_at: null, expires_at: { [Op.gt]: new Date() } });

/**
 * Issues a new single-use OTP for the user and invalidates every older unused code/token of
 * the same model (so requesting a new code always revokes the previous one).
 * `scope` narrows the records for models holding several kinds (e.g. { kind: 'otp' }).
 * Throws 429 (with retryAfter) when called again within the cooldown.
 * Returns { otp, record }: the raw code must only ever be sent by email.
 */
export const issueOtp = async (TokenModel, { userId, purpose, scope = {}, ttlMs = OTP_TTL_MS }) =>
  sequelize.transaction(async (transaction) => {
    const latest = await TokenModel.findOne({
      where: { user_id: userId, ...scope },
      order: [['created_at', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (latest) {
      const elapsed = (Date.now() - latest.created_at.getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        const retryAfter = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
        throw new AppError(`Please wait ${retryAfter} seconds before requesting another code.`, 429, { retryAfter });
      }
    }

    const now = new Date();
    await TokenModel.update({ used_at: now }, { where: { user_id: userId, used_at: null }, transaction });

    const id = crypto.randomUUID();
    const otp = generateOtp();
    const record = await TokenModel.create(
      { id, user_id: userId, ...scope, token_hash: hashOtp({ recordId: id, purpose, otp }), expires_at: new Date(now.getTime() + ttlMs) },
      { transaction },
    );
    return { otp, record };
  });

/**
 * Checks a submitted code against the user's latest valid code.
 * Wrong guesses are counted and committed (the code is invalidated at MAX_OTP_ATTEMPTS);
 * a correct code is consumed together with every other outstanding code/token of the user.
 *
 * Returns { status: 'valid' } | { status: 'invalid', attemptsRemaining } | { status: 'expired' }
 * ('expired' covers no code, an expired/used code, or one locked by too many attempts).
 */
export const verifyOtp = (TokenModel, { userId, purpose, otp, scope = {}, onValid }) =>
  sequelize.transaction(async (transaction) => {
    const record = await TokenModel.findOne({
      where: { user_id: userId, ...scope, ...unexpired() },
      order: [['created_at', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!record || record.attempts >= MAX_OTP_ATTEMPTS) return { status: 'expired' };

    if (!otpMatches({ recordId: record.id, purpose, otp, storedHash: record.token_hash })) {
      const attempts = record.attempts + 1;
      await record.update({ attempts, ...(attempts >= MAX_OTP_ATTEMPTS && { used_at: new Date() }) }, { transaction });
      return { status: 'invalid', attemptsRemaining: Math.max(0, MAX_OTP_ATTEMPTS - attempts) };
    }

    await consumeUserTokens(TokenModel, userId, transaction);
    const extra = onValid ? await onValid(transaction) : {};
    return { status: 'valid', ...extra };
  });

// Removes a code whose email could not be delivered, so the user can request another one immediately
export const discardToken = (record) => record.destroy().catch(() => {});

/**
 * Issues a 256-bit random single-use token (e.g. the password-reset session granted after a
 * correct OTP). Returns the raw token; only its SHA-256 hash is stored.
 */
export const issueSessionToken = async (TokenModel, { userId, scope = {}, ttlMs = OTP_TTL_MS }, transaction) => {
  const { token, tokenHash } = generateSecureToken();
  const record = await TokenModel.create(
    { user_id: userId, ...scope, token_hash: tokenHash, expires_at: new Date(Date.now() + ttlMs) },
    { transaction },
  );
  return { token, expiresAt: record.expires_at };
};

/**
 * Finds a valid (unused, unexpired) token record by its raw value, locked for update inside the
 * transaction. Returns null for unknown, used or expired tokens.
 */
export const findValidToken = (TokenModel, token, { scope = {}, transaction } = {}) =>
  TokenModel.findOne({
    where: { token_hash: hashToken(token), ...scope, ...unexpired() },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });

// Marks every unused code/token of the user as used
export const consumeUserTokens = (TokenModel, userId, transaction) =>
  TokenModel.update({ used_at: new Date() }, { where: { user_id: userId, used_at: null }, transaction });
