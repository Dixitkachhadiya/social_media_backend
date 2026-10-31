import AppError from '../utils/AppError.js';

/**
 * Restricts a route to the given roles. Must run after `protect`.
 *
 * Usage: router.get('/path', protect, authorize('admin'), handler)
 */
export const authorize =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError('You do not have permission to perform this action', 403);
    }
    next();
  };
