import http from 'node:http';
import { io as connectClient } from 'socket.io-client';
import app from '../src/app.js';
import { initSocket, closeSocket } from '../src/socket/index.js';
import { api, auth, resetDatabase, closeDatabase, createUser, createPost, signExpiredToken } from './helpers.js';

let server;
let url;
const clients = [];

const connect = (token) =>
  new Promise((resolve, reject) => {
    const client = connectClient(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    clients.push(client);
    client.on('connected', (info) => resolve({ client, info }));
    client.on('connect_error', (error) => reject(error));
  });

const nextEvent = (client, event, timeoutMs = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No "${event}" event within ${timeoutMs}ms`)), timeoutMs);
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const expectNoEvent = (client, event, waitMs = 400) =>
  new Promise((resolve, reject) => {
    const handler = (payload) => reject(new Error(`Unexpected "${event}": ${JSON.stringify(payload)}`));
    client.on(event, handler);
    setTimeout(() => {
      client.off(event, handler);
      resolve();
    }, waitMs);
  });

beforeAll(async () => {
  await resetDatabase();
  server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await closeSocket();
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

describe('Socket.IO authentication', () => {
  test('rejects connections without a token', async () => {
    await expect(connect()).rejects.toThrow('Authentication required');
  });

  test('rejects invalid and expired tokens', async () => {
    const { user } = await createUser({ login: false });
    await expect(connect('not.a.token')).rejects.toThrow('Invalid token');
    await expect(connect(signExpiredToken(user))).rejects.toThrow('Token has expired');
  });

  test('joins only the own user room (plus the admin room for admins)', async () => {
    const regular = await createUser();
    const admin = await createUser({ role: 'admin' });

    const { info: userInfo } = await connect(regular.token);
    expect(userInfo.rooms).toEqual([`user:${regular.user.id}`]);

    const { info: adminInfo } = await connect(admin.token);
    expect(adminInfo.rooms).toEqual([`user:${admin.user.id}`, 'admins']);
  });
});

describe('real-time notifications', () => {
  test('the post owner receives like and comment notifications; other users do not', async () => {
    const owner = await createUser();
    const fan = await createUser();
    const bystander = await createUser();
    const post = await createPost(owner.token, 'live post');

    const { client: ownerSocket } = await connect(owner.token);
    const { client: bystanderSocket } = await connect(bystander.token);

    const likeEvent = nextEvent(ownerSocket, 'notification');
    const silence = expectNoEvent(bystanderSocket, 'notification');
    await api().post(`/api/posts/${post.id}/like`).set(auth(fan.token));

    expect(await likeEvent).toMatchObject({
      type: 'like',
      post_id: post.id,
      related_user: { id: fan.user.id, username: fan.user.username },
      is_read: false,
    });

    const commentEvent = nextEvent(ownerSocket, 'notification');
    await api().post(`/api/posts/${post.id}/comments`).set(auth(fan.token)).send({ content: 'live comment' });
    expect((await commentEvent).type).toBe('comment');

    await silence;
  });

  test('admins receive login notifications in real time', async () => {
    const admin = await createUser({ role: 'admin' });
    const member = await createUser({ login: false });
    const { client: adminSocket } = await connect(admin.token);

    const notification = nextEvent(adminSocket, 'notification');
    const activity = nextEvent(adminSocket, 'admin:user-login');
    await api().post('/api/auth/login').send({ email: member.user.email, password: member.password });

    expect(await notification).toMatchObject({ type: 'login', message: `${member.user.username} logged in` });
    expect((await activity).user.id).toBe(member.user.id);
  });

  test('the database stays the source of truth for clients that reconnect', async () => {
    const owner = await createUser();
    const fan = await createUser();
    const post = await createPost(owner.token, 'offline post');

    // Owner is not connected when the like happens
    await api().post(`/api/posts/${post.id}/like`).set(auth(fan.token));

    const missed = await api().get('/api/notifications?unread=true').set(auth(owner.token));
    expect(missed.body.notifications.map((n) => n.type)).toEqual(['like']);
  });
});
