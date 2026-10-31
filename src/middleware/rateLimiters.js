import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const MINUTE = 60 * 1000;

// Automated tests run hundreds of requests from one IP
const skip = () => process.env.NODE_ENV === 'test';

const limiter = ({ windowMs, limit, message, ...options }) =>
  rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message },
    ...options,
  });

// Every /api request, per IP
export const apiLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 1000,
  message: 'Too many requests. Please try again later.',
});

// Login/register brute-force protection: only failed attempts count
export const authLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Too many failed attempts. Please try again in 15 minutes.',
});

// Emails (verification, password reset): per IP + target, so one address cannot be flooded
export const emailLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 5,
  keyGenerator: (req) => {
    const target = req.user?.id || String(req.body?.email || '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}:${target}`;
  },
  message: 'Too many email requests. Please try again in 15 minutes.',
});

// Token checks (verify/reset password with a reset token): slows down token guessing
export const tokenLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 20,
  message: 'Too many attempts. Please try again later.',
});

// OTP code checks, per IP + account (JWT user or submitted email). Each code also allows only
// 5 wrong guesses before it is invalidated, so guessing a 6-digit code is not practical.
export const otpLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  keyGenerator: (req) => {
    const target = req.user?.id || String(req.body?.email || '').trim().toLowerCase();
    return `otp:${ipKeyGenerator(req.ip)}:${target}`;
  },
  message: 'Too many code attempts. Please try again in 15 minutes.',
});

// Content checks run on the local moderation model (no provider quota): more generous, per user
export const moderationLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 120,
  keyGenerator: (req) => `moderation:${req.user.id}`,
  message: 'Too many content checks. Please try again in a few minutes.',
});

// Summaries (local CPU work): per authenticated user
export const aiLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 60,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'Summary limit reached. Please try again in 15 minutes.',
});
