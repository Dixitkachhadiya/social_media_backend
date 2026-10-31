import { api, auth, resetDatabase, closeDatabase, createUser, signExpiredToken } from './helpers.js';
import { User, Notification } from '../src/models/index.js';

beforeAll(resetDatabase);
afterAll(closeDatabase);

describe('POST /api/auth/register', () => {
  const body = { username: 'jane_doe', email: 'Jane@Example.com', password: 'Password123!' };

  test('creates a user, returns a token and never the password', async () => {
    const res = await api().post('/api/auth/register').send(body);
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ username: 'jane_doe', email: 'jane@example.com', role: 'user' });
    expect(res.body.user).not.toHaveProperty('password');

    const stored = await User.scope('withPassword').findOne({ where: { email: 'jane@example.com' } });
    expect(stored.password).toMatch(/^\$2[aby]\$12\$/);
  });

  test('ignores a role supplied in the body', async () => {
    const res = await api().post('/api/auth/register').send({ username: 'sneaky', email: 'sneaky@example.com', password: 'Password123!', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });

  test('rejects duplicate email (case-insensitive) with 409', async () => {
    const res = await api().post('/api/auth/register').send({ ...body, username: 'other_name', email: 'JANE@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email is already registered');
  });

  test('rejects duplicate username (case-insensitive) with 409', async () => {
    const res = await api().post('/api/auth/register').send({ ...body, username: 'JANE_DOE', email: 'new@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Username is already taken');
  });

  test('validates input with field errors', async () => {
    const res = await api().post('/api/auth/register').send({ username: 'ab', email: 'bad', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field).sort()).toEqual(['email', 'password', 'username']);
  });
});

describe('POST /api/auth/login', () => {
  test('logs in with valid credentials and records last_login_at', async () => {
    const { user, password } = await createUser({ login: false });
    const res = await api().post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).not.toHaveProperty('password');
    await user.reload();
    expect(user.last_login_at).toBeInstanceOf(Date);
  });

  test('returns the same 401 for a wrong password and an unknown email', async () => {
    const { user } = await createUser({ login: false });
    const wrong = await api().post('/api/auth/login').send({ email: user.email, password: 'WrongPassword!' });
    const unknown = await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Password123!' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  test('rejects deactivated accounts with 403', async () => {
    const { user, password } = await createUser({ is_active: false });
    const res = await api().post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(403);
  });

  test('notifies other active admins once per login burst, never the user themself', async () => {
    const { user: admin } = await createUser({ role: 'admin', login: false });
    const { user, password } = await createUser({ login: false });

    await api().post('/api/auth/login').send({ email: user.email, password });
    await api().post('/api/auth/login').send({ email: user.email, password });

    const notifications = await Notification.findAll({ where: { user_id: admin.id, type: 'login', related_user_id: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe(`${user.username} logged in`);
    expect(notifications[0].message).not.toMatch(/password|token/i);

    // An admin's own login does not notify themselves
    await api().post('/api/auth/login').send({ email: admin.email, password: 'Password123!' });
    expect(await Notification.count({ where: { user_id: admin.id, related_user_id: admin.id } })).toBe(0);
  });
});

describe('authentication middleware (GET /api/auth/me)', () => {
  test('rejects requests without a token', async () => {
    const res = await api().get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('rejects malformed and invalid tokens', async () => {
    expect((await api().get('/api/auth/me').set('Authorization', 'Token abc')).status).toBe(401);
    const res = await api().get('/api/auth/me').set(auth('not.a.token'));
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid token');
  });

  test('rejects expired tokens', async () => {
    const { user } = await createUser({ login: false });
    const res = await api().get('/api/auth/me').set(auth(signExpiredToken(user)));
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Token has expired');
  });

  test('returns the authenticated user without the password', async () => {
    const { user, token } = await createUser();
    const res = await api().get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user).not.toHaveProperty('password');
  });

  test('blocks a valid token once the account is deactivated', async () => {
    const { user, token } = await createUser();
    await user.update({ is_active: false });
    const res = await api().get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe('authorization middleware', () => {
  test('admin routes: 401 without token, 403 for users, 200 for admins', async () => {
    const { token: userToken } = await createUser();
    const { token: adminToken } = await createUser({ role: 'admin' });

    expect((await api().get('/api/admin/test')).status).toBe(401);
    expect((await api().get('/api/admin/test').set(auth(userToken))).status).toBe(403);
    expect((await api().get('/api/admin/test').set(auth(adminToken))).status).toBe(200);
  });

  test('a demoted admin loses access immediately, even with an admin token', async () => {
    const { user, token } = await createUser({ role: 'admin' });
    await user.update({ role: 'user' });
    expect((await api().get('/api/admin/test').set(auth(token))).status).toBe(403);
  });
});
