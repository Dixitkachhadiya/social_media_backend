import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { sequelize, User } from '../src/models/index.js';
import { outbox } from './mockMailer.js';
import { isTestDatabaseName } from './testDatabase.js';

export const api = () => request(app);

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

const TABLES = [
  'notifications', 'likes', 'comments', 'posts', 'email_verifications', 'password_resets', 'profiles', 'users',
];

// Empties every table of the TEST database (guarded against running anywhere else)
export const resetDatabase = async () => {
  if (!isTestDatabaseName(sequelize.getDatabaseName())) {
    throw new Error('Refusing to truncate a non-test database');
  }
  await sequelize.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
};

export const closeDatabase = () => sequelize.close();

let sequence = 0;

/**
 * Creates a user directly in the database and logs in through the API.
 * Admins can only be created this way: the API never accepts roles.
 */
export const createUser = async ({ role = 'user', password = 'Password123!', login = true, ...attributes } = {}) => {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence}`;
  const user = await User.create({
    username: `user_${suffix}`,
    email: `user_${suffix}@test.com`,
    password,
    role,
    ...attributes,
  });

  let token;
  if (login && user.is_active) {
    const res = await api().post('/api/auth/login').send({ email: user.email, password });
    token = res.body.token;
  }
  return { user, token, password };
};

export const createPost = async (token, content = 'Hello world from a test post') => {
  const res = await api().post('/api/posts').set(auth(token)).send({ content });
  return res.body.post;
};

export const signExpiredToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, iat: Math.floor(Date.now() / 1000) - 7200 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );

// Most recent email delivered to the address through the mocked SMTP transport
export const lastEmail = (email) => [...outbox].reverse().find((m) => m.to === email);

// Reads the 6-digit code from the most recent email sent to the address
export const lastEmailOtp = (email) => lastEmail(email)?.text.match(/Your code: (\d{6})/)?.[1];

// Number of emails sent to the address so far
export const emailCount = (email) => outbox.filter((m) => m.to === email).length;
