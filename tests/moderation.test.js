// Mandatory moderation of posts and comments, with MOCKED inference (tests/mockModeration.js).
// The real local model is tested by tests/moderation.integration.test.js and tests/aiModel.test.js.
import { jest } from '@jest/globals';
import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { Post, Comment } from '../src/models/index.js';
import { setModerationEngine, checkContent } from '../src/services/moderationService.js';
import { fakeModeration, useFakeModeration } from './mockModeration.js';

let alice;
let bob;
const seen = [];

const publish = (token, content) => api().post('/api/posts').set(auth(token)).send({ content });
const comment = (token, postId, content) => api().post(`/api/posts/${postId}/comments`).set(auth(token)).send({ content });

const expectBlocked = (res, category) => {
  expect(res.status).toBe(422);
  expect(res.body).toMatchObject({ success: false, blocked: true, code: 'CONTENT_MODERATION_FAILED' });
  expect(res.body.message).toBe('Please remove inappropriate words from your content before publishing.');
  if (category) expect(res.body.moderation.category).toBe(category);
};

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser();
  bob = await createUser();
});
beforeEach(() => {
  seen.length = 0;
  // Record what the backend sends to the model, then answer like the fake
  setModerationEngine(async (text) => {
    seen.push(text);
    return fakeModeration(text);
  });
});
afterAll(async () => {
  useFakeModeration();
  await closeDatabase();
});

describe('posts', () => {
  test('1. a clean English post is published', async () => {
    const res = await publish(alice.token, 'Had a great time at the conference today, learned a lot!');
    expect(res.status).toBe(201);
    expect(seen).toEqual(['Had a great time at the conference today, learned a lot!']);
  });

  test('2. a vulgar English post is blocked and nothing is saved', async () => {
    const before = await Post.count();
    const res = await publish(alice.token, 'This fucking traffic made me late again.');
    expectBlocked(res, 'VULGAR');
    expect(res.body.moderation).toMatchObject({ is_toxic: true, severity: 'medium', detected_language: 'English' });
    expect(res.body.moderation.flagged_terms).toEqual([{ text: 'fucking', start: 5, end: 12, category: 'VULGAR' }]);
    expect(await Post.count()).toBe(before);
  });

  test.each([
    ['3. Hindi', 'तू एकदम चूतिया है, सब खराब कर दिया।', 'PERSONAL_ABUSE'],
    ['4. Gujarati', 'તું સાવ નાલાયક છે.', 'PERSONAL_ABUSE'],
    ['5. Hinglish', 'Bro tu literally chutiya hai, plan kharab kar diya', 'PERSONAL_ABUSE'],
    ['6. Gujarati transliterated', 'Tu sav nalayak che, kaam bagadi nakhyu', 'PERSONAL_ABUSE'],
    ['7. Hindi transliterated', 'Kal mil, jaan se maar dunga', 'THREAT'],
    ['8. mixed language', 'Dude this report is late again, tu ekdum chutiya hai yaar', 'PERSONAL_ABUSE'],
    ['11. harassment', 'Face it, nobody wants you in this group.', 'HARASSMENT'],
    ['12. threat', 'If you post that again I will kill you.', 'THREAT'],
    ['mild profanity (blocked by project policy)', 'damn, missed the bus again', 'MILD_PROFANITY'],
  ])('%s content is blocked with the detected category', async (_, text, category) => {
    const res = await publish(alice.token, text);
    expectBlocked(res, category);
    for (const f of res.body.moderation.flagged_terms) expect(text.slice(f.start, f.end)).toBe(f.text);
  });

  test.each([
    ['9. clean negative feedback', 'The service was slow and the food arrived cold. Disappointed.'],
    ['10. ordinary criticism', 'This policy is badly thought out, I strongly disagree with it.'],
  ])('%s is published', async (_, text) => {
    expect((await publish(alice.token, text)).status).toBe(201);
  });

  test('uncertain content is refused with a rephrase message (never silently approved)', async () => {
    const res = await publish(alice.token, 'Something borderline [uncertain]');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ blocked: true, code: 'CONTENT_MODERATION_FAILED', moderation: { decision: 'uncertain', is_toxic: null } });
    expect(res.body.message).toMatch(/couldn't verify/);
  });

  test('15. an edited post with vulgar words is refused and the original kept', async () => {
    const post = await createPost(alice.token, 'Looking forward to the workshop.');
    const res = await api().put(`/api/posts/${post.id}`).set(auth(alice.token)).send({ content: 'This fucking workshop' });
    expectBlocked(res, 'VULGAR');
    expect((await Post.findByPk(post.id)).content).toBe('Looking forward to the workshop.');
    // Ownership is checked before moderation, and an image-only edit needs no check
    expect((await api().put(`/api/posts/${post.id}`).set(auth(bob.token)).send({ content: 'x' })).status).toBe(403);
    seen.length = 0;
    await api().put(`/api/posts/${post.id}`).set(auth(alice.token)).send({ image_url: null }).expect(200);
    expect(seen).toHaveLength(0);
  });
});

describe('comments', () => {
  let post;
  beforeAll(async () => {
    post = await createPost(bob.token, 'A post to comment on');
  });

  test('13. a clean comment is saved', async () => {
    const res = await comment(alice.token, post.id, 'Great point, thanks for sharing!');
    expect(res.status).toBe(201);
  });

  test('14. a vulgar comment is blocked, not saved, and does not notify the post owner', async () => {
    const before = await Comment.count();
    const res = await comment(alice.token, post.id, 'What an idiot take');
    expectBlocked(res, 'PERSONAL_ABUSE');
    expect(await Comment.count()).toBe(before);
    const notifications = await api().get('/api/notifications').set(auth(bob.token));
    expect(notifications.body.notifications.some((n) => n.message.includes('idiot'))).toBe(false);
  });

  test('16. an edited comment with vulgar words is refused and the original kept', async () => {
    const created = (await comment(alice.token, post.id, 'Nice photo!')).body.comment;
    const res = await api().put(`/api/comments/${created.id}`).set(auth(alice.token)).send({ content: 'Nice photo, idiot' });
    expectBlocked(res, 'PERSONAL_ABUSE');
    expect((await Comment.findByPk(created.id)).content).toBe('Nice photo!');
    expect((await api().put(`/api/comments/${created.id}`).set(auth(bob.token)).send({ content: 'x' })).status).toBe(403);
  });
});

describe('bypass and trust', () => {
  test('17. direct API calls are moderated and client-supplied moderation fields are rejected', async () => {
    const forged = await api().post('/api/posts').set(auth(alice.token)).send({ content: 'kill you', moderation: { blocked: false } });
    expect(forged.status).toBe(400);
    expect(forged.body.message).toMatch(/Unknown fields: moderation/);

    const direct = await api().post('/api/posts').set(auth(alice.token)).set('X-Moderation-Passed', 'true').send({ content: 'I will kill you' });
    expectBlocked(direct, 'THREAT');
  });

  test('the response does not expose model internals', async () => {
    const res = await publish(alice.token, 'This fucking traffic');
    expect(res.body.moderation).not.toHaveProperty('model');
    expect(res.body.moderation).not.toHaveProperty('signals');
    expect(res.body.moderation).not.toHaveProperty('latency_ms');
  });

  test('POST /api/ai/moderate-content runs the same check without saving', async () => {
    const before = await Post.count();
    const res = await api().post('/api/ai/moderate-content').set(auth(alice.token)).send({ content: 'damn this' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ decision: 'block', category: 'MILD_PROFANITY', message: 'Please remove inappropriate words from your content before publishing.' });
    expect(await Post.count()).toBe(before);
  });
});

describe('18. moderation model unavailable (fail closed)', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  test.each([
    ['model not loaded', () => { throw new Error('model not loaded'); }],
    ['inference error', async () => { throw new RangeError('Invalid array length'); }],
    ['malformed result', async () => ({ unexpected: true })],
  ])('%s: posts and comments are refused with 503 and nothing is saved', async (_, failure) => {
    setModerationEngine(failure);
    const post = await Post.findOne();
    const [posts, comments] = [await Post.count(), await Comment.count()];

    const p = await publish(alice.token, 'A perfectly normal post');
    const c = await comment(alice.token, post.id, 'A perfectly normal comment');
    for (const res of [p, c]) {
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'MODERATION_UNAVAILABLE', message: 'Content checking is temporarily unavailable. Please try again.' });
    }
    expect([await Post.count(), await Comment.count()]).toEqual([posts, comments]);
    // A safe technical log line, never the content
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/\[moderation\] Check failed/);
    expect(logged).not.toMatch(/perfectly normal/);
  });

  test('the real model refuses input it cannot check (no mock): 503, not a silent pass', async () => {
    setModerationEngine(null);
    await expect(checkContent('a'.repeat(10001))).rejects.toMatchObject({ statusCode: 503, code: 'MODERATION_UNAVAILABLE' });
  });
});

describe('19. two users submitting independently', () => {
  test('each submission is checked on its own and attributed to its author', async () => {
    const [a, b] = await Promise.all([
      publish(alice.token, 'Morning run done, feeling great.'),
      publish(bob.token, 'Tu ekdum chutiya hai'),
    ]);
    expect(a.status).toBe(201);
    expect(a.body.post.author.id).toBe(alice.user.id);
    expectBlocked(b, 'PERSONAL_ABUSE');
    expect(seen.sort()).toEqual(['Morning run done, feeling great.', 'Tu ekdum chutiya hai'].sort());
  });
});
