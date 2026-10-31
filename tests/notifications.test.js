import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { Notification } from '../src/models/index.js';

let owner;
let other;
let admin;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser();
  other = await createUser();
  admin = await createUser({ role: 'admin' });

  const post = await createPost(owner.token, 'notify me');
  await api().post(`/api/posts/${post.id}/like`).set(auth(other.token));
  await api().post(`/api/posts/${post.id}/comments`).set(auth(other.token)).send({ content: 'first comment' });
});
afterAll(closeDatabase);

describe('notifications', () => {
  test('requires authentication', async () => {
    expect((await api().get('/api/notifications')).status).toBe(401);
  });

  test('lists own notifications newest first with the actor', async () => {
    const res = await api().get('/api/notifications').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.notifications.map((n) => n.type)).toEqual(['comment', 'like']);
    expect(res.body.notifications[0].related_user).toEqual({ id: other.user.id, username: other.user.username });
    expect(res.body.unread_count).toBe(2);
  });

  test('returns the unread count', async () => {
    const res = await api().get('/api/notifications/unread-count').set(auth(owner.token));
    expect(res.body.unread_count).toBe(2);
  });

  test("marks one as read; cannot touch another user's notification", async () => {
    const [latest] = (await api().get('/api/notifications').set(auth(owner.token))).body.notifications;

    expect((await api().patch(`/api/notifications/${latest.id}/read`).set(auth(other.token))).status).toBe(404);
    expect((await api().delete(`/api/notifications/${latest.id}`).set(auth(other.token))).status).toBe(404);

    const res = await api().patch(`/api/notifications/${latest.id}/read`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.unread_count).toBe(1);

    const unreadOnly = await api().get('/api/notifications?unread=true').set(auth(owner.token));
    expect(unreadOnly.body.notifications).toHaveLength(1);
  });

  test('marks all as read', async () => {
    const res = await api().patch('/api/notifications/read-all').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect((await api().get('/api/notifications/unread-count').set(auth(owner.token))).body.unread_count).toBe(0);
  });

  test('deletes a notification', async () => {
    const [first] = (await api().get('/api/notifications').set(auth(owner.token))).body.notifications;
    expect((await api().delete(`/api/notifications/${first.id}`).set(auth(owner.token))).status).toBe(200);
    expect(await Notification.findByPk(first.id)).toBeNull();
  });

  test('admin announcements reach every active user', async () => {
    const forbidden = await api().post('/api/admin/announcements').set(auth(owner.token)).send({ message: 'hi' });
    expect(forbidden.status).toBe(403);

    const res = await api().post('/api/admin/announcements').set(auth(admin.token)).send({ message: 'Maintenance tonight' });
    expect(res.status).toBe(201);
    expect(res.body.recipients).toBe(3);

    const inbox = await api().get('/api/notifications').set(auth(other.token));
    expect(inbox.body.notifications[0]).toMatchObject({ type: 'announcement', message: 'Maintenance tonight' });
  });
});
