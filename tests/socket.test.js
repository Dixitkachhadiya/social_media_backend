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

describe('live post activity (likes and comments update without refreshing)', () => {
  test('every connected user receives counts for likes, comments, edits and deletions, never content', async () => {
    const author = await createUser();
    const fan = await createUser();
    const viewer = await createUser();
    const post = await createPost(author.token, 'Live update test post');
    const { client } = await connect(viewer.token);

    const like = nextEvent(client, 'post:activity');
    await api().post(`/api/posts/${post.id}/like`).set(auth(fan.token)).expect(201);
    expect(await like).toEqual({ post_id: post.id, type: 'like', actor_id: fan.user.id, likes_count: 1, comments_count: 0 });

    const added = nextEvent(client, 'post:activity');
    const created = await api().post(`/api/posts/${post.id}/comments`).set(auth(fan.token)).send({ content: 'Nice one!' }).expect(201);
    const addedEvent = await added;
    expect(addedEvent).toMatchObject({ post_id: post.id, type: 'comment-added', comments_count: 1, comment_id: created.body.comment.id });
    expect(JSON.stringify(addedEvent)).not.toContain('Nice one');

    const edited = nextEvent(client, 'post:activity');
    await api().put(`/api/comments/${created.body.comment.id}`).set(auth(fan.token)).send({ content: 'Nice one, edited' }).expect(200);
    expect((await edited).type).toBe('comment-updated');

    const removed = nextEvent(client, 'post:activity');
    await api().delete(`/api/comments/${created.body.comment.id}`).set(auth(fan.token)).expect(200);
    expect(await removed).toMatchObject({ type: 'comment-deleted', comments_count: 0 });

    const unliked = nextEvent(client, 'post:activity');
    await api().delete(`/api/posts/${post.id}/like`).set(auth(fan.token)).expect(200);
    expect(await unliked).toMatchObject({ type: 'unlike', likes_count: 0 });

    const deleted = nextEvent(client, 'post:activity');
    await api().delete(`/api/posts/${post.id}`).set(auth(author.token)).expect(200);
    expect(await deleted).toMatchObject({ type: 'post-deleted', post_id: post.id });
  });

  test('a refused (moderated) comment broadcasts nothing', async () => {
    const author = await createUser();
    const post = await createPost(author.token, 'Another post');
    const { client } = await connect(author.token);
    const silent = expectNoEvent(client, 'post:activity');
    await api().post(`/api/posts/${post.id}/comments`).set(auth(author.token)).send({ content: 'you idiot' }).expect(422);
    await silent;
  });
});
