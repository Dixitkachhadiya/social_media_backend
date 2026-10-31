import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { Post } from '../src/models/index.js';
import { setAIProvider } from '../src/services/aiService.js';

// Fake provider: records prompts and returns canned text (no network, no quota)
const calls = [];
const fakeProvider = (reply = 'AI generated text') => ({
  name: 'fake',
  model: 'fake-model',
  generate: async (request) => {
    calls.push(request);
    if (reply instanceof Error) throw reply;
    return reply;
  },
});

let user;

beforeAll(async () => {
  await resetDatabase();
  user = await createUser();
});
afterEach(() => {
  calls.length = 0;
  setAIProvider(null);
});
afterAll(closeDatabase);

describe('AI configuration and errors', () => {
  test('responds 503 when no provider is configured', async () => {
    const res = await api().post('/api/ai/generate-post').set(auth(user.token)).send({ topic: 'Testing' });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/not configured/);
  });

  test('requires authentication', async () => {
    expect((await api().post('/api/ai/generate-post').send({ topic: 'x' })).status).toBe(401);
  });

  test('maps provider quota errors to 429 with Retry-After', async () => {
    setAIProvider(fakeProvider(Object.assign(new Error('Resource has been exhausted'), { status: 429 })));
    const res = await api().post('/api/ai/improve-post').set(auth(user.token)).send({ content: 'hello' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  test('hides internal provider error details', async () => {
    setAIProvider(fakeProvider(Object.assign(new Error('API key AIza-secret is invalid'), { status: 400 })));
    const res = await api().post('/api/ai/improve-post').set(auth(user.token)).send({ content: 'hello' });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('AIza');
  });
});

describe('POST /api/ai/generate-post', () => {
  test('generates a post with the requested tone without publishing it', async () => {
    setAIProvider(fakeProvider('Learning to code opens doors. #programming'));
    const postsBefore = await Post.count();

    const res = await api()
      .post('/api/ai/generate-post')
      .set(auth(user.token))
      .send({ topic: 'Importance of learning programming', tone: 'Professional' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      content: 'Learning to code opens doors. #programming',
      topic: 'Importance of learning programming',
      tone: 'professional',
    });
    expect(res.body.meta.published).toBe(false);
    expect(calls[0].prompt).toContain('<user_input>\nImportance of learning programming\n</user_input>');
    expect(await Post.count()).toBe(postsBefore);
  });

  test('validates topic and tone', async () => {
    setAIProvider(fakeProvider());
    expect((await api().post('/api/ai/generate-post').set(auth(user.token)).send({})).status).toBe(400);
    const tone = await api().post('/api/ai/generate-post').set(auth(user.token)).send({ topic: 'x', tone: 'angry' });
    expect(tone.status).toBe(400);
    expect(tone.body.errors[0].field).toBe('tone');
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/ai/improve-post', () => {
  test('returns improved content alongside the original', async () => {
    setAIProvider(fakeProvider('I am learning Node.js, and I really enjoy it.'));
    const res = await api()
      .post('/api/ai/improve-post')
      .set(auth(user.token))
      .send({ content: 'i am learning node js and it is very good' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      original: 'i am learning node js and it is very good',
      improved: 'I am learning Node.js, and I really enjoy it.',
    });
  });

  test('rejects content that is too long', async () => {
    setAIProvider(fakeProvider());
    expect((await api().post('/api/ai/improve-post').set(auth(user.token)).send({ content: 'x'.repeat(2001) })).status).toBe(400);
  });
});

describe('POST /api/ai/summarize', () => {
  test('handles posts without comments without calling the provider', async () => {
    setAIProvider(fakeProvider());
    const post = await createPost(user.token, 'Quiet post');
    const res = await api().post('/api/ai/summarize').set(auth(user.token)).send({ postId: post.id });

    expect(res.status).toBe(200);
    expect(res.body.data.comments_total).toBe(0);
    expect(res.body.meta.ai_generated).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('summarizes a post and its comments', async () => {
    setAIProvider(fakeProvider('People agree that testing matters.'));
    const post = await createPost(user.token, 'Should we write tests?');
    const commenter = await createUser();
    await api().post(`/api/posts/${post.id}/comments`).set(auth(commenter.token)).send({ content: 'Absolutely, always.' });

    const res = await api().post('/api/ai/summarize').set(auth(user.token)).send({ postId: post.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ summary: 'People agree that testing matters.', comments_total: 1, comments_included: 1 });
    expect(calls[0].prompt).toContain('Absolutely, always.');
  });

  test('limits the content sent to the provider', async () => {
    setAIProvider(fakeProvider('summary'));
    const post = await createPost(user.token, 'Busy thread');
    const commenter = await createUser();
    for (let i = 0; i < 60; i += 1) {
      await api().post(`/api/posts/${post.id}/comments`).set(auth(commenter.token)).send({ content: `comment ${i} ${'y'.repeat(900)}` });
    }

    const res = await api().post('/api/ai/summarize').set(auth(user.token)).send({ postId: post.id });
    expect(res.status).toBe(200);
    expect(res.body.data.comments_total).toBe(60);
    expect(res.body.data.comments_included).toBeLessThanOrEqual(50);
    expect(calls[0].prompt.length).toBeLessThan(13000);
  });

  test('returns 404 for missing or hidden posts and 400 for invalid IDs', async () => {
    setAIProvider(fakeProvider());
    const hiddenAuthor = await createUser();
    const hidden = await createPost(hiddenAuthor.token, 'hidden');
    await hiddenAuthor.user.update({ is_active: false });

    expect((await api().post('/api/ai/summarize').set(auth(user.token)).send({ postId: hidden.id })).status).toBe(404);
    expect((await api().post('/api/ai/summarize').set(auth(user.token)).send({ postId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await api().post('/api/ai/summarize').set(auth(user.token)).send({ postId: 'abc' })).status).toBe(400);
  });
});
