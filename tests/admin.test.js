import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { User, Post } from '../src/models/index.js';

let admin;
let user;

beforeAll(async () => {
  await resetDatabase();
  admin = await createUser({ role: 'admin', username: 'chief_admin' });
  user = await createUser({ username: 'regular_rita' });
  await createUser({ username: 'inactive_ian', is_active: false });
});
afterAll(closeDatabase);

describe('admin access control', () => {
  test('requires authentication and the admin role', async () => {
    expect((await api().get('/api/admin/users')).status).toBe(401);
    expect((await api().get('/api/admin/users').set(auth(user.token))).status).toBe(403);
    expect((await api().get('/api/admin/dashboard/stats').set(auth(user.token))).status).toBe(403);
  });
});

describe('user management', () => {
  test('lists users with pagination and never exposes passwords', async () => {
    const res = await api().get('/api/admin/users?limit=2').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ total: 3, total_pages: 2 });
    res.body.users.forEach((u) => expect(u).not.toHaveProperty('password'));
  });

  test('searches by username or email and filters by role and status', async () => {
    const search = await api().get('/api/admin/users?search=RITA').set(auth(admin.token));
    expect(search.body.users.map((u) => u.username)).toEqual(['regular_rita']);

    const byEmail = await api().get(`/api/admin/users?search=${encodeURIComponent(user.user.email)}`).set(auth(admin.token));
    expect(byEmail.body.users).toHaveLength(1);

    const admins = await api().get('/api/admin/users?role=admin').set(auth(admin.token));
    expect(admins.body.users.map((u) => u.username)).toEqual(['chief_admin']);

    const inactive = await api().get('/api/admin/users?status=inactive').set(auth(admin.token));
    expect(inactive.body.users.map((u) => u.username)).toEqual(['inactive_ian']);

    expect((await api().get('/api/admin/users?role=superuser').set(auth(admin.token))).status).toBe(400);
  });

  test('treats LIKE wildcards in search literally', async () => {
    const res = await api().get('/api/admin/users?search=%25').set(auth(admin.token));
    expect(res.body.users).toHaveLength(0);
  });

  test('shows user details with activity counts', async () => {
    await createPost(user.token, 'counted');
    const res = await api().get(`/api/admin/users/${user.user.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'regular_rita', posts_count: 1, comments_count: 0 });
    expect(res.body.user).not.toHaveProperty('password');
    expect((await api().get('/api/admin/users/00000000-0000-4000-8000-000000000000').set(auth(admin.token))).status).toBe(404);
  });

  test('deactivates and reactivates an account; deactivation revokes access', async () => {
    const off = await api().patch(`/api/admin/users/${user.user.id}/status`).set(auth(admin.token)).send({ is_active: false });
    expect(off.status).toBe(200);
    expect(off.body.user.is_active).toBe(false);
    expect((await api().get('/api/auth/me').set(auth(user.token))).status).toBe(403);

    const on = await api().patch(`/api/admin/users/${user.user.id}/status`).set(auth(admin.token)).send({ is_active: true });
    expect(on.status).toBe(200);
    expect((await api().get('/api/auth/me').set(auth(user.token))).status).toBe(200);
  });

  test('rejects role changes, invalid values and self-deactivation', async () => {
    const role = await api().patch(`/api/admin/users/${user.user.id}/status`).set(auth(admin.token)).send({ is_active: true, role: 'admin' });
    expect(role.status).toBe(400);
    expect((await User.findByPk(user.user.id)).role).toBe('user');

    const invalid = await api().patch(`/api/admin/users/${user.user.id}/status`).set(auth(admin.token)).send({ is_active: 'no' });
    expect(invalid.status).toBe(400);

    const self = await api().patch(`/api/admin/users/${admin.user.id}/status`).set(auth(admin.token)).send({ is_active: false });
    expect(self.status).toBe(400);
  });

  test('two admins deactivating each other at once cannot remove every admin', async () => {
    const adminB = await createUser({ role: 'admin' });
    const results = await Promise.all([
      api().patch(`/api/admin/users/${adminB.user.id}/status`).set(auth(admin.token)).send({ is_active: false }),
      api().patch(`/api/admin/users/${admin.user.id}/status`).set(auth(adminB.token)).send({ is_active: false }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await User.count({ where: { role: 'admin', is_active: true } })).toBe(1);

    // Restore both for the remaining tests
    await User.update({ is_active: true }, { where: { role: 'admin' } });
    await adminB.user.destroy();
  });

  test('deletes users (with cascading content) but not yourself', async () => {
    const victim = await createUser();
    const post = await createPost(victim.token, 'will be removed');

    expect((await api().delete(`/api/admin/users/${admin.user.id}`).set(auth(admin.token))).status).toBe(400);

    const res = await api().delete(`/api/admin/users/${victim.user.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(await User.findByPk(victim.user.id)).toBeNull();
    expect(await Post.findByPk(post.id)).toBeNull();
    expect((await api().delete(`/api/admin/users/${victim.user.id}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('dashboard', () => {
  test('returns aggregate statistics', async () => {
    const res = await api().get('/api/admin/dashboard/stats').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.stats.users).toMatchObject({ total: 3, active: 2, inactive: 1, admins: 1 });
    expect(res.body.stats.content).toMatchObject({ posts: 1, comments: 0, likes: 0 });
    expect(res.body.stats.recent_logins.length).toBeGreaterThan(0);
  });

  test('returns a paginated activity timeline that can be filtered', async () => {
    const res = await api().get('/api/admin/dashboard/recent-activity?limit=5').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBeLessThanOrEqual(5);
    expect(res.body.pagination.total).toBeGreaterThan(0);

    const logins = await api().get('/api/admin/dashboard/recent-activity?type=login').set(auth(admin.token));
    expect(logins.body.activities.every((a) => a.type === 'login')).toBe(true);
  });

  test('returns recent users and recent posts', async () => {
    const users = await api().get('/api/admin/dashboard/recent-users?limit=2').set(auth(admin.token));
    expect(users.status).toBe(200);
    expect(users.body.users).toHaveLength(2);
    users.body.users.forEach((u) => expect(u).not.toHaveProperty('password'));

    const posts = await api().get('/api/admin/dashboard/recent-posts').set(auth(admin.token));
    expect(posts.status).toBe(200);
    expect(posts.body.posts[0]).toHaveProperty('likes_count');
  });
});
