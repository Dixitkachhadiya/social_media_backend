import crypto from 'node:crypto';

export const OTP_LENGTH = 6;

// Cryptographically secure, uniformly distributed 6-digit code (leading zeros kept)
export const generateOtp = () => crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');

// A 6-digit code has only a million values, so a plain SHA-256 hash could be reversed by brute
// force if the table leaked. Codes are therefore stored as HMAC-SHA256 with a server-side secret,
// bound to the record and its purpose so a hash is only valid for one code record.
const otpSecret = () => {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('OTP_SECRET or JWT_SECRET must be set');
  return secret;
};

export const hashOtp = ({ recordId, purpose, otp }) =>
  crypto.createHmac('sha256', otpSecret()).update(`${purpose}:${recordId}:${otp}`).digest('hex');

// Constant-time comparison of a submitted code against the stored hash
export const otpMatches = ({ recordId, purpose, otp, storedHash }) => {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashOtp({ recordId, purpose, otp }), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

// "priya@example.com" -> "pr***@example.com" (for UI confirmation, never for lookups)
export const maskEmail = (email) => {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};
