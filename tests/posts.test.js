import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { Post } from '../src/models/index.js';

let alice;
let bob;
let admin;

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser();
  bob = await createUser();
  admin = await createUser({ role: 'admin' });
});
afterAll(closeDatabase);

describe('creating posts', () => {
  test('creates a post owned by the authenticated user', async () => {
    const res = await api()
      .post('/api/posts')
      .set(auth(alice.token))
      .send({ content: '  My first post  ', image_url: 'https://example.com/pic.png' });

    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({
      content: 'My first post',
      image_url: 'https://example.com/pic.png',
      likes_count: 0,
      comments_count: 0,
      liked_by_me: false,
      author: { id: alice.user.id, username: alice.user.username },
    });
    expect(res.body.post.created_at).toBeDefined();
  });

  test('requires authentication', async () => {
    expect((await api().post('/api/posts').send({ content: 'anon' })).status).toBe(401);
  });

  test('never accepts ownership from the request body', async () => {
    const res = await api().post('/api/posts').set(auth(alice.token)).send({ content: 'hi', user_id: bob.user.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unknown fields: user_id/);
  });

  test('validates content and image URL', async () => {
    const empty = await api().post('/api/posts').set(auth(alice.token)).send({ content: '   ' });
    expect(empty.status).toBe(400);

    const tooLong = await api().post('/api/posts').set(auth(alice.token)).send({ content: 'x'.repeat(5001) });
    expect(tooLong.status).toBe(400);

    const badUrl = await api().post('/api/posts').set(auth(alice.token)).send({ content: 'ok', image_url: 'javascript:alert(1)' });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.errors[0].field).toBe('image_url');
  });
});

describe('reading posts', () => {
  test('lists posts publicly, newest first, with pagination', async () => {
    await createPost(bob.token, 'Bob post 1');
    await createPost(bob.token, 'Bob post 2');

    const res = await api().get('/api/posts?limit=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(2);
    expect(res.body.posts[0].content).toBe('Bob post 2');
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, total_pages: 2 });

    const page2 = await api().get('/api/posts?limit=2&page=2');
    expect(page2.body.posts).toHaveLength(1);
  });

  test('filters by author', async () => {
    const res = await api().get(`/api/posts?user_id=${bob.user.id}`);
    expect(res.body.posts.every((p) => p.author.id === bob.user.id)).toBe(true);
  });

  test('gets a single post; 404 for unknown and 400 for malformed IDs', async () => {
    const post = await createPost(alice.token, 'Single');
    expect((await api().get(`/api/posts/${post.id}`)).body.post.content).toBe('Single');
    expect((await api().get('/api/posts/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api().get('/api/posts/not-a-uuid')).status).toBe(400);
  });

  test('validates pagination parameters', async () => {
    expect((await api().get('/api/posts?limit=500')).status).toBe(400);
    expect((await api().get('/api/posts?page=0')).status).toBe(400);
  });
});

describe('post ownership', () => {
  test('owner can update; others (including admins) cannot', async () => {
    const post = await createPost(alice.token, 'Original');

    const own = await api().put(`/api/posts/${post.id}`).set(auth(alice.token)).send({ content: 'Edited' });
    expect(own.status).toBe(200);
    expect(own.body.post.content).toBe('Edited');

    expect((await api().put(`/api/posts/${post.id}`).set(auth(bob.token)).send({ content: 'Hacked' })).status).toBe(403);
    expect((await api().put(`/api/posts/${post.id}`).set(auth(admin.token)).send({ content: 'Admin edit' })).status).toBe(403);
    expect((await Post.findByPk(post.id)).content).toBe('Edited');
  });

  test('image can be removed with null; empty update is rejected', async () => {
    const created = await api().post('/api/posts').set(auth(alice.token)).send({ content: 'pic', image_url: 'https://example.com/a.png' });
    const res = await api().put(`/api/posts/${created.body.post.id}`).set(auth(alice.token)).send({ image_url: null });
    expect(res.status).toBe(200);
    expect(res.body.post.image_url).toBeNull();

    expect((await api().put(`/api/posts/${created.body.post.id}`).set(auth(alice.token)).send({})).status).toBe(400);
  });

  test('others cannot delete; owner and admin (moderation) can', async () => {
    const post1 = await createPost(alice.token, 'to delete');
    expect((await api().delete(`/api/posts/${post1.id}`).set(auth(bob.token))).status).toBe(403);

    const own = await api().delete(`/api/posts/${post1.id}`).set(auth(alice.token));
    expect(own.status).toBe(200);
    expect(own.body.message).toBe('Post deleted successfully');

    const post2 = await createPost(bob.token, 'inappropriate');
    const moderated = await api().delete(`/api/posts/${post2.id}`).set(auth(admin.token));
    expect(moderated.status).toBe(200);
    expect(moderated.body.message).toBe('Post removed by moderator');
    expect(await Post.findByPk(post2.id)).toBeNull();
  });

  test('posts of deactivated users are hidden from the public but visible to admins', async () => {
    const carol = await createUser();
    const post = await createPost(carol.token, 'soon hidden');
    await carol.user.update({ is_active: false });

    expect((await api().get(`/api/posts/${post.id}`)).status).toBe(404);
    expect((await api().get('/api/posts?limit=50')).body.posts.some((p) => p.id === post.id)).toBe(false);
    expect((await api().get(`/api/posts/${post.id}`).set(auth(admin.token))).status).toBe(200);
  });
});
