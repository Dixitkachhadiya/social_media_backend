import crypto from 'node:crypto';

// SHA-256 is appropriate here (unlike for passwords): tokens are 256-bit random
// values, so they cannot be brute-forced from the hash.
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Returns the raw token (sent to the user once) and its hash (stored in the database)
export const generateSecureToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
};
