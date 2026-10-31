import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';

let viewer;
let author;
let posts;

beforeAll(async () => {
  await resetDatabase();
  viewer = await createUser();
  author = await createUser();
  posts = [];
  for (const content of ['first', 'second', 'third']) {
    posts.push(await createPost(author.token, content));
  }
  // "first" becomes the most liked post
  await api().post(`/api/posts/${posts[0].id}/like`).set(auth(viewer.token));
  await api().post(`/api/posts/${posts[0].id}/like`).set(auth(author.token));
  await api().post(`/api/posts/${posts[1].id}/like`).set(auth(author.token));
  await api().post(`/api/posts/${posts[1].id}/comments`).set(auth(viewer.token)).send({ content: 'nice' });
});
afterAll(closeDatabase);

describe('GET /api/feed', () => {
  test('requires authentication', async () => {
    expect((await api().get('/api/feed')).status).toBe(401);
  });

  test('returns latest first with author, counts and liked_by_me', async () => {
    const res = await api().get('/api/feed').set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.posts.map((p) => p.content)).toEqual(['third', 'second', 'first']);

    const [third, second, first] = res.body.posts;
    expect(first).toMatchObject({ likes_count: 2, comments_count: 0, liked_by_me: true });
    expect(second).toMatchObject({ likes_count: 1, comments_count: 1, liked_by_me: false });
    expect(third.author).toMatchObject({ id: author.user.id, username: author.user.username });
    expect(third.author).not.toHaveProperty('email');
  });

  test('supports pagination and popular sorting', async () => {
    const page = await api().get('/api/feed?page=2&limit=2').set(auth(viewer.token));
    expect(page.body.posts.map((p) => p.content)).toEqual(['first']);
    expect(page.body.pagination).toMatchObject({ page: 2, limit: 2, total: 3, total_pages: 2 });

    const popular = await api().get('/api/feed?sort=popular').set(auth(viewer.token));
    expect(popular.body.posts.map((p) => p.content)).toEqual(['first', 'second', 'third']);

    expect((await api().get('/api/feed?sort=random').set(auth(viewer.token))).status).toBe(400);
  });

  test('excludes posts from deactivated users', async () => {
    const quitter = await createUser();
    await createPost(quitter.token, 'from a deactivated user');
    await quitter.user.update({ is_active: false });

    const res = await api().get('/api/feed?limit=50').set(auth(viewer.token));
    expect(res.body.posts.some((p) => p.author.id === quitter.user.id)).toBe(false);
  });
});
