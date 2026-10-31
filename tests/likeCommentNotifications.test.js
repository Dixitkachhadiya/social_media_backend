// End-to-end like/comment notifications across three users:
// stored rows (recipient, actor, type, post), REST responses, unread counts and live Socket.IO delivery.
import http from 'node:http';
import { io as connectClient } from 'socket.io-client';
import app from '../src/app.js';
import { initSocket, closeSocket } from '../src/socket/index.js';
import { Notification } from '../src/models/index.js';
import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';

let server;
let url;
const clients = [];
let userA;
let userB;
let userC;

const connect = (token) =>
  new Promise((resolve, reject) => {
    const client = connectClient(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    clients.push(client);
    client.on('connected', () => resolve(client));
    client.on('connect_error', reject);
  });

const collect = (client, event = 'notification') => {
  const received = [];
  client.on(event, (payload) => received.push(payload));
  return received;
};

const waitUntil = async (predicate, timeoutMs = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for socket events');
    await new Promise((r) => setTimeout(r, 25));
  }
};

const settle = () => new Promise((r) => setTimeout(r, 300));

const notificationsFor = (user, where = {}) => Notification.findAll({ where: { user_id: user.user.id, ...where }, order: [['created_at', 'ASC']] });

const unreadCount = async (user) => (await api().get('/api/notifications/unread-count').set(auth(user.token))).body.unread_count;

beforeAll(async () => {
  await resetDatabase();
  server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

beforeEach(async () => {
  // Fresh users per scenario so counts are independent
  userA = await createUser();
  userB = await createUser();
  userC = await createUser();
});

afterEach(() => {
  clients.splice(0).forEach((c) => c.disconnect());
});

afterAll(async () => {
  await closeSocket();
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

describe('Scenario 1: like', () => {
  test('A gets exactly one stored and live notification naming B; B gets none', async () => {
    const socketA = await connect(userA.token);
    const socketB = await connect(userB.token);
    const liveA = collect(socketA);
    const liveB = collect(socketB);
    const post = await createPost(userA.token, 'A’s post');

    await api().post(`/api/posts/${post.id}/like`).set(auth(userB.token)).expect(201);
    await waitUntil(() => liveA.length === 1);

    const [stored] = await notificationsFor(userA);
    expect(stored).toMatchObject({ type: 'like', related_user_id: userB.user.id, post_id: post.id, is_read: false });
    expect(stored.message).toBe(`${userB.user.username} liked your post`);
    expect(liveA[0]).toMatchObject({ id: stored.id, type: 'like', post_id: post.id, related_user: { id: userB.user.id, username: userB.user.username } });
    expect(await unreadCount(userA)).toBe(1);

    await settle();
    expect(liveB).toHaveLength(0);
    expect(await notificationsFor(userB)).toHaveLength(0);
  });

  test('a repeated like (409) and like → unlike → like never duplicate the notification', async () => {
    const post = await createPost(userA.token);
    await api().post(`/api/posts/${post.id}/like`).set(auth(userB.token)).expect(201);
    await api().post(`/api/posts/${post.id}/like`).set(auth(userB.token)).expect(409);
    await api().delete(`/api/posts/${post.id}/like`).set(auth(userB.token)).expect(200);
    await api().post(`/api/posts/${post.id}/like`).set(auth(userB.token)).expect(201);

    // Unliking keeps the original notification (documented behaviour)
    expect(await notificationsFor(userA, { type: 'like' })).toHaveLength(1);
  });
});

describe('Scenario 2: comment', () => {
  test('A is notified about C’s comment with a preview; C gets nothing', async () => {
    const socketA = await connect(userA.token);
    const socketC = await connect(userC.token);
    const liveA = collect(socketA);
    const liveC = collect(socketC);
    const post = await createPost(userA.token);

    await api().post(`/api/posts/${post.id}/comments`).set(auth(userC.token)).send({ content: 'Great point!' }).expect(201);
    await waitUntil(() => liveA.length === 1);

    const [stored] = await notificationsFor(userA);
    expect(stored).toMatchObject({ type: 'comment', related_user_id: userC.user.id, post_id: post.id });
    expect(stored.message).toBe(`${userC.user.username} commented on your post: "Great point!"`);
    expect(liveA[0].related_user.id).toBe(userC.user.id);

    await settle();
    expect(liveC).toHaveLength(0);
    expect(await notificationsFor(userC)).toHaveLength(0);
  });

  test('failed comments create no notification', async () => {
    const post = await createPost(userA.token);
    await api().post(`/api/posts/${post.id}/comments`).set(auth(userC.token)).send({ content: '' }).expect(400);
    await api().post(`/api/posts/${post.id}/comments`).set(auth(userC.token)).send({ content: 'x', user_id: userB.user.id }).expect(400);
    await api().post('/api/posts/00000000-0000-4000-8000-000000000000/comments').set(auth(userC.token)).send({ content: 'x' }).expect(404);
    await api().post(`/api/posts/${post.id}/comments`).send({ content: 'no token' }).expect(401);
    expect(await notificationsFor(userA)).toHaveLength(0);
  });
});

describe('Scenario 3: multiple users', () => {
  test('likes from B and C produce one notification each with the right actor and recipient', async () => {
    const socketA = await connect(userA.token);
    const liveA = collect(socketA);
    const post = await createPost(userA.token);

    await Promise.all([
      api().post(`/api/posts/${post.id}/like`).set(auth(userB.token)).expect(201),
      api().post(`/api/posts/${post.id}/like`).set(auth(userC.token)).expect(201),
    ]);
    await waitUntil(() => liveA.length === 2);

    const stored = await notificationsFor(userA, { type: 'like' });
    expect(stored.map((n) => n.related_user_id).sort()).toEqual([userB.user.id, userC.user.id].sort());
    stored.forEach((n) => expect(n.user_id).toBe(userA.user.id));

    const res = await api().get('/api/notifications').set(auth(userA.token));
    const actors = res.body.notifications.map((n) => n.related_user.username).sort();
    expect(actors).toEqual([userB.user.username, userC.user.username].sort());
    expect(res.body.unread_count).toBe(2);
    expect(liveA.map((n) => n.related_user.id).sort()).toEqual([userB.user.id, userC.user.id].sort());
  });
});

describe('Scenario 4: offline recipient', () => {
  test('a like while A is logged out is stored and visible after A logs back in', async () => {
    const post = await createPost(userA.token);
    const socketA = await connect(userA.token);
    socketA.disconnect(); // A logs out

    await api().post(`/api/posts/${post.id}/like`).set(auth(userB.token)).expect(201);

    const login = await api().post('/api/auth/login').send({ email: userA.user.email, password: userA.password }).expect(200);
    const res = await api().get('/api/notifications?unread=true').set(auth(login.body.token));
    expect(res.body.unread_count).toBe(1);
    expect(res.body.notifications[0]).toMatchObject({ type: 'like', post_id: post.id, related_user: { id: userB.user.id } });

    // The existing read endpoints work on it
    await api().patch(`/api/notifications/${res.body.notifications[0].id}/read`).set(auth(login.body.token)).expect(200);
    expect(await unreadCount(userA)).toBe(0);
  });
});

describe('Scenario 5: account switching', () => {
  test('B sees only B’s notifications, and live events follow the current account', async () => {
    const postA = await createPost(userA.token);
    const postB = await createPost(userB.token);

    const oldSocket = await connect(userA.token);
    const liveOld = collect(oldSocket);
    oldSocket.disconnect(); // A logs out
    const socketB = await connect(userB.token); // B logs in
    const liveB = collect(socketB);

    await api().post(`/api/posts/${postA.id}/like`).set(auth(userC.token)).expect(201); // for A
    await api().post(`/api/posts/${postB.id}/comments`).set(auth(userC.token)).send({ content: 'hi B' }).expect(201); // for B
    await waitUntil(() => liveB.length === 1);
    await settle();

    expect(liveB).toHaveLength(1);
    expect(liveB[0]).toMatchObject({ type: 'comment', post_id: postB.id });
    expect(liveOld).toHaveLength(0);

    const listB = await api().get('/api/notifications').set(auth(userB.token));
    expect(listB.body.notifications).toHaveLength(1);
    expect(listB.body.notifications[0].post_id).toBe(postB.id);
    expect(listB.body.notifications.some((n) => n.post_id === postA.id)).toBe(false);
  });
});

describe('Scenario 6: own post', () => {
  test('liking or commenting on your own post creates no notification', async () => {
    const socketA = await connect(userA.token);
    const liveA = collect(socketA);
    const post = await createPost(userA.token);

    await api().post(`/api/posts/${post.id}/like`).set(auth(userA.token)).expect(201);
    await api().post(`/api/posts/${post.id}/comments`).set(auth(userA.token)).send({ content: 'my own comment' }).expect(201);
    await settle();

    expect(liveA).toHaveLength(0);
    expect(await notificationsFor(userA)).toHaveLength(0);
    expect(await unreadCount(userA)).toBe(0);
  });
});
