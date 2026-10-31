import { User } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { verifyToken } from '../utils/jwt.js';

/**
 * Verifies a JWT and returns the matching active user.
 * Shared by HTTP middleware and Socket.IO authentication.
 *
 * The token's id/email/role claims identify the user, but the database is the
 * source of truth: deleted, deactivated or demoted accounts lose access
 * immediately, and tokens issued before a password change are rejected.
 */
export const authenticateToken = async (token) => {
  let payload;
  try {
    payload = verifyToken(token);
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    throw new AppError(message, 401);
  }

  const user = payload.id ? await User.findByPk(payload.id) : null;
  if (!user) {
    throw new AppError('User belonging to this token no longer exists', 401);
  }
  if (!user.is_active) {
    throw new AppError('This account has been deactivated', 403);
  }
  if (user.password_changed_at && payload.iat < Math.floor(user.password_changed_at.getTime() / 1000)) {
    throw new AppError('Password was changed recently. Please log in again.', 401);
  }

  return user;
};

const extractBearerToken = (req) => {
  const header = req.headers.authorization;
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) {
    throw new AppError('Authentication required. Provide a Bearer token.', 401);
  }
  return token;
};

/**
 * Requires "Authorization: Bearer <token>" and attaches the user to req.user.
 * Identity is never read from the request body.
 */
export const protect = async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AppError('Authentication required. Provide a Bearer token.', 401);
  }

  // Safe user instance: password is excluded by the model's default scope
  req.user = await authenticateToken(token);
  next();
};

/**
 * For public routes that personalize their response (e.g. "liked_by_me").
 * No header: continues anonymously. A header with a bad token is still rejected.
 */
export const optionalAuth = async (req, res, next) => {
  const token = extractBearerToken(req);
  if (token) {
    req.user = await authenticateToken(token);
  }
  next();
};
