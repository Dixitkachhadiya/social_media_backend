import { User } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { signToken } from '../utils/jwt.js';
import { notifySafely, notifyAdminsOfLogin } from '../services/notificationService.js';

// POST /api/auth/register
export const register = async (req, res) => {
  // Only whitelisted fields; role and flags can never be set by the client
  const { username, email, password } = req.body ?? {};

  if ([username, email, password].some((value) => value !== undefined && typeof value !== 'string')) {
    throw new AppError('username, email and password must be strings', 400);
  }

  const user = await User.create({ username, email, password });

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    token: signToken(user),
    user,
  });
};

// POST /api/auth/login
export const login = async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const user = await User.scope('withPassword').findOne({
    where: { email: email.trim().toLowerCase() },
  });

  // Same message for unknown email and wrong password to avoid account enumeration
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid email or password', 401);
  }
  if (!user.is_active) {
    throw new AppError('This account has been deactivated', 403);
  }

  await user.update({ last_login_at: new Date() });
  await notifySafely(() => notifyAdminsOfLogin(user));

  res.status(200).json({
    success: true,
    message: 'Login successful',
    token: signToken(user),
    user,
  });
};

// GET /api/auth/me
export const getMe = async (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
};
