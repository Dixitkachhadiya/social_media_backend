// Multi-user identity: every action must be attributed to the user of the verified JWT,
// never to a user named in the request body or to a previously active session.
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { io as connectClient } from 'socket.io-client';
import app from '../src/app.js';
import { initSocket, closeSocket } from '../src/socket/index.js';
import { Post, Like, Comment, Notification } from '../src/models/index.js';
import { api, auth, resetDatabase, closeDatabase, createUser, createPost, signExpiredToken } from './helpers.js';

let server;
let url;
const clients = [];

let userA;
let userB;
let userC;
let postA;
let commentB;

const connect = (token) =>
  new Promise((resolve, reject) => {
    const client = connectClient(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    clients.push(client);
    client.on('connected', (info) => resolve({ client, info }));
    client.on('connect_error', reject);
  });

const nextEvent = (client, event, timeoutMs = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No "${event}" event within ${timeoutMs}ms`)), timeoutMs);
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const collect = (client, event) => {
  const received = [];
  client.on(event, (payload) => received.push(payload));
  return received;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  await resetDatabase();
  server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;

  userA = await createUser();
  userB = await createUser();
  userC = await createUser();
});

afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await closeSocket();
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

describe('Test A: user A creates a post', () => {
  test('the post is owned by A (from the JWT)', async () => {
    postA = await createPost(userA.token, 'Post written by user A');
    expect(postA.author.id).toBe(userA.user.id);
    expect((await Post.findByPk(postA.id)).user_id).toBe(userA.user.id);
  });

  test('an identity in the request body is rejected, not used', async () => {
    const res = await api()
      .post('/api/posts')
      .set(auth(userB.token))
      .send({ content: 'Pretending to be A', user_id: userA.user.id });
    expect(res.status).toBe(400);
    expect(await Post.count({ where: { user_id: userA.user.id } })).toBe(1);
  });
});

describe('Test B: user B interacts with A’s post', () => {
  test('/auth/me identifies B', async () => {
    const res = await api().get('/api/auth/me').set(auth(userB.token));
    expect(res.body.user.id).toBe(userB.user.id);
  });

  test('B’s like is stored with B’s id', async () => {
    const res = await api().post(`/api/posts/${postA.id}/like`).set(auth(userB.token));
    expect(res.status).toBe(201);

    const likes = await Like.findAll({ where: { post_id: postA.id } });
    expect(likes.map((l) => l.user_id)).toEqual([userB.user.id]);

    const list = await api().get(`/api/posts/${postA.id}/likes`);
    expect(list.body.likes.map((l) => l.user.id)).toEqual([userB.user.id]);
  });

  test('liked_by_me is personal to each viewer', async () => {
    const asB = await api().get(`/api/posts/${postA.id}`).set(auth(userB.token));
    const asA = await api().get(`/api/posts/${postA.id}`).set(auth(userA.token));
    expect(asB.body.post.liked_by_me).toBe(true);
    expect(asA.body.post.liked_by_me).toBe(false);
  });

  test('B’s comment is authored by B', async () => {
    const res = await api().post(`/api/posts/${postA.id}/comments`).set(auth(userB.token)).send({ content: 'Comment by B' });
    expect(res.status).toBe(201);
    commentB = res.body.comment;
    expect(commentB.author.id).toBe(userB.user.id);
    expect((await Comment.findByPk(commentB.id)).user_id).toBe(userB.user.id);
  });

  test('a comment author in the body is rejected', async () => {
    const res = await api()
      .post(`/api/posts/${postA.id}/comments`)
      .set(auth(userB.token))
      .send({ content: 'spoof', user_id: userA.user.id });
    expect(res.status).toBe(400);
  });

  test('A is notified with B as the actor; B receives nothing', async () => {
    const forA = await Notification.findAll({ where: { user_id: userA.user.id, post_id: postA.id } });
    expect(forA.map((n) => n.type).sort()).toEqual(['comment', 'like']);
    forA.forEach((n) => expect(n.related_user_id).toBe(userB.user.id));

    const res = await api().get('/api/notifications').set(auth(userA.token));
    res.body.notifications.forEach((n) => expect(n.related_user).toMatchObject({ id: userB.user.id, username: userB.user.username }));
    expect(res.body.notifications.every((n) => n.message.startsWith(userB.user.username))).toBe(true);

    const forB = await api().get('/api/notifications').set(auth(userB.token));
    expect(forB.body.notifications).toHaveLength(0);
  });
});

describe('Test C: back to user A', () => {
  test('a fresh login as A restores A’s identity and profile', async () => {
    const login = await api().post('/api/auth/login').send({ email: userA.user.email, password: userA.password });
    const me = await api().get('/api/users/profile').set(auth(login.body.token));
    expect(me.body.user.id).toBe(userA.user.id);
    expect(me.body.user.email).toBe(userA.user.email);
  });

  test('A sees B’s like and comment on the post', async () => {
    const post = await api().get(`/api/posts/${postA.id}`).set(auth(userA.token));
    expect(post.body.post).toMatchObject({ likes_count: 1, comments_count: 1 });
    const comments = await api().get(`/api/posts/${postA.id}/comments`).set(auth(userA.token));
    expect(comments.body.comments[0].author.id).toBe(userB.user.id);
  });

  test('A cannot edit or delete B’s comment', async () => {
    const edit = await api().put(`/api/comments/${commentB.id}`).set(auth(userA.token)).send({ content: 'edited by A' });
    expect(edit.status).toBe(403);
    const del = await api().delete(`/api/comments/${commentB.id}`).set(auth(userA.token));
    expect(del.status).toBe(403);
    expect((await Comment.findByPk(commentB.id)).content).toBe('Comment by B');
  });

  test('B cannot edit or delete A’s post', async () => {
    expect((await api().put(`/api/posts/${postA.id}`).set(auth(userB.token)).send({ content: 'x' })).status).toBe(403);
    expect((await api().delete(`/api/posts/${postA.id}`).set(auth(userB.token))).status).toBe(403);
  });
});

describe('Test D: a third user and interleaved sessions', () => {
  test('C’s like and comment are attributed to C, not to an earlier user', async () => {
    await api().post(`/api/posts/${postA.id}/like`).set(auth(userC.token)).expect(201);
    const res = await api().post(`/api/posts/${postA.id}/comments`).set(auth(userC.token)).send({ content: 'Comment by C' });
    expect(res.body.comment.author.id).toBe(userC.user.id);

    const likers = (await Like.findAll({ where: { post_id: postA.id } })).map((l) => l.user_id).sort();
    expect(likers).toEqual([userB.user.id, userC.user.id].sort());
    const notification = await Notification.findOne({ where: { user_id: userA.user.id, type: 'comment', related_user_id: userC.user.id } });
    expect(notification).not.toBeNull();
  });

  test('concurrent requests from different users never mix identities', async () => {
    const post = await createPost(userC.token, 'Concurrency check');
    const users = [userA, userB];
    const responses = await Promise.all(
      users.flatMap((u) => [
        api().post(`/api/posts/${post.id}/comments`).set(auth(u.token)).send({ content: `from ${u.user.username}` }),
        api().get('/api/auth/me').set(auth(u.token)),
      ]),
    );
    users.forEach((u, i) => {
      expect(responses[i * 2].body.comment.author.id).toBe(u.user.id);
      expect(responses[i * 2].body.comment.content).toBe(`from ${u.user.username}`);
      expect(responses[i * 2 + 1].body.user.id).toBe(u.user.id);
    });
  });
});

describe('private account information', () => {
  test('/users/profile always returns the caller’s own account', async () => {
    const res = await api().get('/api/users/profile').set(auth(userB.token));
    expect(res.body.user.id).toBe(userB.user.id);
    expect(res.body.user.email).toBe(userB.user.email);
  });

  test('B sees only A’s public profile (no email, role or flags)', async () => {
    const res = await api().get(`/api/users/${userA.user.id}`).set(auth(userB.token));
    expect(res.status).toBe(200);
    expect(res.body.user).not.toHaveProperty('email');
    expect(res.body.user).not.toHaveProperty('role');
    expect(res.body.user).not.toHaveProperty('is_active');
  });

  test('B cannot read A’s account through admin endpoints', async () => {
    expect((await api().get(`/api/admin/users/${userA.user.id}`).set(auth(userB.token))).status).toBe(403);
  });

  test('B cannot read, mark or delete A’s notifications', async () => {
    const [notification] = await Notification.findAll({ where: { user_id: userA.user.id }, limit: 1 });
    expect((await api().patch(`/api/notifications/${notification.id}/read`).set(auth(userB.token))).status).toBe(404);
    expect((await api().delete(`/api/notifications/${notification.id}`).set(auth(userB.token))).status).toBe(404);
    expect(await Notification.findByPk(notification.id)).not.toBeNull();
  });
});

describe('invalid credentials are rejected', () => {
  const protectedCalls = () => [
    ['create post', (r) => r.post('/api/posts').send({ content: 'x' })],
    ['like', (r) => r.post(`/api/posts/${postA.id}/like`)],
    ['comment', (r) => r.post(`/api/posts/${postA.id}/comments`).send({ content: 'x' })],
    ['profile', (r) => r.get('/api/users/profile')],
  ];

  test('missing token -> 401', async () => {
    for (const [, call] of protectedCalls()) {
      expect((await call(api())).status).toBe(401);
    }
  });

  test('malformed, expired and foreign-signed tokens -> 401', async () => {
    const forged = jwt.sign({ id: userA.user.id, email: userA.user.email, role: 'admin' }, 'not-the-server-secret', { expiresIn: '1h' });
    const tokens = ['not.a.jwt', signExpiredToken(userA.user), forged];
    for (const token of tokens) {
      for (const [name, call] of protectedCalls()) {
        const res = await call(api()).set(auth(token));
        expect([name, res.status]).toEqual([name, 401]);
      }
    }
    // Nothing was written on behalf of A by the rejected requests
    expect(await Post.count({ where: { user_id: userA.user.id } })).toBe(1);
  });
});

describe('Socket.IO identity', () => {
  test('each socket is identified from its own JWT and joins only its own room', async () => {
    const a = await connect(userA.token);
    const b = await connect(userB.token);
    expect(a.info).toEqual({ user_id: userA.user.id, rooms: [`user:${userA.user.id}`] });
    expect(b.info).toEqual({ user_id: userB.user.id, rooms: [`user:${userB.user.id}`] });
  });

  test('a notification for A is delivered only to A, with the real actor', async () => {
    const a = await connect(userA.token);
    const b = await connect(userB.token);
    const receivedByB = collect(b.client, 'notification');

    const post = await createPost(userA.token, 'Socket attribution');
    const incoming = nextEvent(a.client, 'notification');
    await api().post(`/api/posts/${post.id}/comments`).set(auth(userC.token)).send({ content: 'live from C' }).expect(201);

    const notification = await incoming;
    expect(notification.related_user).toEqual({ id: userC.user.id, username: userC.user.username });
    expect(notification.post_id).toBe(post.id);
    await wait(300);
    expect(receivedByB).toHaveLength(0);
  });

  test('after switching accounts, the new socket receives only the new user’s events', async () => {
    const old = await connect(userA.token);
    old.client.disconnect(); // logout
    const receivedByOld = collect(old.client, 'notification');

    const current = await connect(userB.token);
    const post = await createPost(userB.token, 'B’s own post');
    const incoming = nextEvent(current.client, 'notification');
    await api().post(`/api/posts/${post.id}/like`).set(auth(userC.token)).expect(201);

    expect((await incoming).related_user.id).toBe(userC.user.id);
    expect(receivedByOld).toHaveLength(0);
  });
});
