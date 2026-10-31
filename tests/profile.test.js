import { api, auth, resetDatabase, closeDatabase, createUser } from './helpers.js';

beforeAll(resetDatabase);
afterAll(closeDatabase);

describe('profile management', () => {
  test('requires authentication', async () => {
    expect((await api().get('/api/users/profile')).status).toBe(401);
    expect((await api().put('/api/users/profile').send({ bio: 'x' })).status).toBe(401);
  });

  test('returns and updates the own profile', async () => {
    const { user, token } = await createUser();

    const initial = await api().get('/api/users/profile').set(auth(token));
    expect(initial.status).toBe(200);
    expect(initial.body.user.email).toBe(user.email);
    expect(initial.body.user.profile.bio).toBeNull();

    const update = await api()
      .put('/api/users/profile')
      .set(auth(token))
      .send({ full_name: 'Test Person', bio: 'Hello!', website: 'https://example.com' });
    expect(update.status).toBe(200);
    expect(update.body.user.profile).toMatchObject({ full_name: 'Test Person', bio: 'Hello!', website: 'https://example.com' });
  });

  test('rejects restricted fields with 403 and changes nothing', async () => {
    const { token } = await createUser();
    const res = await api().put('/api/users/profile').set(auth(token)).send({ bio: 'escalate', role: 'admin', is_active: false });
    expect(res.status).toBe(403);

    const after = await api().get('/api/users/profile').set(auth(token));
    expect(after.body.user.role).toBe('user');
    expect(after.body.user.profile.bio).not.toBe('escalate');
  });

  test('validates profile fields', async () => {
    const { token } = await createUser();
    const res = await api().put('/api/users/profile').set(auth(token)).send({ website: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('website');
  });

  test('public profile hides private information', async () => {
    const { user } = await createUser({ login: false });
    const res = await api().get(`/api/users/${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(user.username);
    ['email', 'password', 'role', 'is_active', 'is_email_verified'].forEach((field) =>
      expect(res.body.user).not.toHaveProperty(field),
    );
  });
});
