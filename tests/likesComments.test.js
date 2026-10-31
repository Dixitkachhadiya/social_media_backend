import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { Notification, Like } from '../src/models/index.js';

let owner;
let fan;
let admin;
let post;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser();
  fan = await createUser();
  admin = await createUser({ role: 'admin' });
  post = await createPost(owner.token, 'Like and comment on me');
});
afterAll(closeDatabase);

describe('likes', () => {
  test('likes a post and returns the updated count', async () => {
    const res = await api().post(`/api/posts/${post.id}/like`).set(auth(fan.token));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ liked: true, likes_count: 1 });
  });

  test('prevents duplicate likes with 409', async () => {
    const res = await api().post(`/api/posts/${post.id}/like`).set(auth(fan.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('You have already liked this post');
    expect(await Like.count({ where: { post_id: post.id } })).toBe(1);
  });

  test('the database rejects concurrent duplicate likes', async () => {
    const racer = await createUser();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api().post(`/api/posts/${post.id}/like`).set(auth(racer.token))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    await api().delete(`/api/posts/${post.id}/like`).set(auth(racer.token));
  });

  test('shows likes in post details and the likes list', async () => {
    const details = await api().get(`/api/posts/${post.id}`).set(auth(fan.token));
    expect(details.body.post).toMatchObject({ likes_count: 1, liked_by_me: true });

    const anonymous = await api().get(`/api/posts/${post.id}`);
    expect(anonymous.body.post.liked_by_me).toBe(false);

    const list = await api().get(`/api/posts/${post.id}/likes`);
    expect(list.status).toBe(200);
    expect(list.body.likes[0].user.username).toBe(fan.user.username);
    expect(list.body.likes[0].user).not.toHaveProperty('email');
  });

  test('unlikes a post; unliking twice returns 404', async () => {
    const res = await api().delete(`/api/posts/${post.id}/like`).set(auth(fan.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ liked: false, likes_count: 0 });
    expect((await api().delete(`/api/posts/${post.id}/like`).set(auth(fan.token))).status).toBe(404);
  });

  test('notifies the post owner once, even after like -> unlike -> like', async () => {
    await api().post(`/api/posts/${post.id}/like`).set(auth(fan.token));
    const where = { user_id: owner.user.id, type: 'like', related_user_id: fan.user.id, post_id: post.id };
    expect(await Notification.count({ where })).toBe(1);
  });

  test('liking your own post creates no notification', async () => {
    await api().post(`/api/posts/${post.id}/like`).set(auth(owner.token));
    expect(await Notification.count({ where: { user_id: owner.user.id, related_user_id: owner.user.id } })).toBe(0);
  });

  test('liking requires authentication and an existing post', async () => {
    expect((await api().post(`/api/posts/${post.id}/like`)).status).toBe(401);
    expect((await api().post('/api/posts/00000000-0000-4000-8000-000000000000/like').set(auth(fan.token))).status).toBe(404);
  });
});

describe('comments', () => {
  let commentId;

  test('adds a comment and notifies the post owner', async () => {
    const res = await api().post(`/api/posts/${post.id}/comments`).set(auth(fan.token)).send({ content: 'Great post!' });
    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({ content: 'Great post!', author: { id: fan.user.id } });
    commentId = res.body.comment.id;

    const notification = await Notification.findOne({ where: { user_id: owner.user.id, type: 'comment' } });
    expect(notification.message).toContain('commented on your post');
  });

  test('validates comment content', async () => {
    expect((await api().post(`/api/posts/${post.id}/comments`).set(auth(fan.token)).send({ content: '' })).status).toBe(400);
    expect((await api().post(`/api/posts/${post.id}/comments`).set(auth(fan.token)).send({ content: 'x'.repeat(1001) })).status).toBe(400);
    expect((await api().post(`/api/posts/${post.id}/comments`).send({ content: 'anon' })).status).toBe(401);
  });

  test('lists comments oldest first with authors and updates the post count', async () => {
    await api().post(`/api/posts/${post.id}/comments`).set(auth(owner.token)).send({ content: 'Thanks!' });

    const res = await api().get(`/api/posts/${post.id}/comments`);
    expect(res.status).toBe(200);
    expect(res.body.comments.map((c) => c.content)).toEqual(['Great post!', 'Thanks!']);
    expect(res.body.comments[0].author.username).toBe(fan.user.username);
    expect(res.body.pagination.total).toBe(2);

    expect((await api().get(`/api/posts/${post.id}`)).body.post.comments_count).toBe(2);
  });

  test('only the author can edit a comment', async () => {
    expect((await api().put(`/api/comments/${commentId}`).set(auth(owner.token)).send({ content: 'nope' })).status).toBe(403);
    const res = await api().put(`/api/comments/${commentId}`).set(auth(fan.token)).send({ content: 'Great post, edited' });
    expect(res.status).toBe(200);
    expect(res.body.comment.content).toBe('Great post, edited');
  });

  test('others cannot delete; admins can moderate', async () => {
    expect((await api().delete(`/api/comments/${commentId}`).set(auth(owner.token))).status).toBe(403);
    const res = await api().delete(`/api/comments/${commentId}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Comment removed by moderator');
    expect((await api().delete(`/api/comments/${commentId}`).set(auth(admin.token))).status).toBe(404);
  });

  test('authors can delete their own comments', async () => {
    const created = await api().post(`/api/posts/${post.id}/comments`).set(auth(fan.token)).send({ content: 'temp' });
    const res = await api().delete(`/api/comments/${created.body.comment.id}`).set(auth(fan.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Comment deleted');
  });
});
