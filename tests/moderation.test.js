// Mandatory AI moderation of posts and comments, with a MOCKED model (tests/mockModeration.js): the model's
// JSON is faked, everything else (validation, enforcement, suggestions, fail-closed handling) is real.
// The real Ollama model is tested by tests/moderation.integration.test.js (opt-in) and "npm run ai:check".
import { jest } from '@jest/globals';
import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { Post, Comment } from '../src/models/index.js';
import { setModerationEngine } from '../src/services/moderationService.js';
import { setOllamaTransport } from '../src/services/ollamaService.js';
import { fakeModeration, useFakeModeration } from './mockModeration.js';

const BLOCKED_MESSAGE = 'Your content contains inappropriate language. Review the highlighted words and use the AI suggestion to make your content respectful.';
const BLOCKED_COMMENT_MESSAGE = 'Your comment contains inappropriate language. Please review the highlighted words and use the suggested version before commenting.';

let alice;
let bob;
const seen = [];

const publish = (token, content) => api().post('/api/posts').set(auth(token)).send({ content });
const comment = (token, postId, content) => api().post(`/api/posts/${postId}/comments`).set(auth(token)).send({ content });

const expectBlocked = (res, category, kind = 'post') => {
  expect(res.status).toBe(422);
  expect(res.body).toMatchObject({
    success: false, blocked: true, allowed: false, code: 'CONTENT_MODERATION_FAILED',
    message: kind === 'comment' ? BLOCKED_COMMENT_MESSAGE : BLOCKED_MESSAGE,
  });
  expect(res.body.category).toBe(res.body.moderation.category);
  if (category) expect(res.body.category).toBe(category);
  expect(res.body.flaggedWords.length).toBeGreaterThan(0);
  expect(typeof res.body.reason).toBe('string');
};

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser();
  bob = await createUser();
});
beforeEach(() => {
  seen.length = 0;
  // Record what the backend asks the model, then answer like the fake
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
  test('1. a normal post is published', async () => {
    const res = await publish(alice.token, 'Had a great time at the conference today, learned a lot!');
    expect(res.status).toBe(201);
    expect(seen).toEqual(['Had a great time at the conference today, learned a lot!']);
  });

  test('3. an inappropriate post is refused with flagged words, reason and a suggested version; nothing is saved', async () => {
    const before = await Post.count();
    const text = 'I hate this stupid person. He is an idiot.';
    const res = await publish(alice.token, text);
    expectBlocked(res, 'PERSONAL_ABUSE');
    expect(res.body.flaggedWords).toEqual(['stupid', 'idiot']);
    expect(res.body.suggestedText).toBeTruthy();
    expect(res.body.suggestedText).not.toMatch(/stupid|idiot/i);
    // Highlight positions point at the words in the original text
    for (const f of res.body.moderation.flagged_terms) expect(text.slice(f.start, f.end)).toBe(f.text);
    expect(await Post.count()).toBe(before);
  });

  test.each([
    ['9. English vulgar', 'This fucking traffic made me late again.', 'VULGAR'],
    ['9. Hindi', 'तू एकदम चूतिया है, सब खराब कर दिया।', 'PERSONAL_ABUSE'],
    ['9. Gujarati', 'તું સાવ નાલાયક છે.', 'PERSONAL_ABUSE'],
    ['9. Hinglish', 'Bro tu literally chutiya hai, plan kharab kar diya', 'PERSONAL_ABUSE'],
    ['Gujarati transliterated', 'Tu sav nalayak che, kaam bagadi nakhyu', 'PERSONAL_ABUSE'],
    ['Hindi transliterated threat', 'Kal mil, jaan se maar dunga', 'THREAT'],
    ['harassment', 'Face it, nobody wants you in this group.', 'HARASSMENT'],
    ['hate speech', 'Those people are vermin.', 'HATE_SPEECH'],
    ['mild profanity (blocked by policy)', 'damn, missed the bus again', 'MILD_PROFANITY'],
  ])('%s content is blocked with the detected category', async (_, text, category) => {
    const res = await publish(alice.token, text);
    expectBlocked(res, category);
    for (const f of res.body.moderation.flagged_terms) expect(text.slice(f.start, f.end)).toBe(f.text);
  });

  test.each([
    ['ordinary criticism', 'This policy is badly thought out, I strongly disagree with it.'],
    ['negative feedback', 'The service was slow and the food arrived cold. Disappointed.'],
  ])('%s is published', async (_, text) => {
    expect((await publish(alice.token, text)).status).toBe(201);
  });

  test('7. applying the suggestion lets the cleaned version publish; 8. a still-inappropriate edit is blocked', async () => {
    const refused = await publish(alice.token, 'I hate this stupid person. He is an idiot.');
    expect(refused.status).toBe(422);
    const stillBad = await publish(alice.token, 'I hate this person. He is an idiot.');
    expectBlocked(stillBad, 'PERSONAL_ABUSE');
    const accepted = await publish(alice.token, refused.body.suggestedText);
    expect(accepted.status).toBe(201);
    expect(accepted.body.post.content).toBe(refused.body.suggestedText);
  });

  test('5. editing a post is moderated: an inappropriate edit is refused and the original kept', async () => {
    const post = await createPost(alice.token, 'Looking forward to the workshop.');
    const res = await api().put(`/api/posts/${post.id}`).set(auth(alice.token)).send({ content: 'This fucking workshop' });
    expectBlocked(res, 'VULGAR');
    expect((await Post.findByPk(post.id)).content).toBe('Looking forward to the workshop.');
    // Ownership is checked before moderation, and an image-only edit needs no check
    expect((await api().put(`/api/posts/${post.id}`).set(auth(bob.token)).send({ content: 'x' })).status).toBe(403);
    seen.length = 0;
    await api().put(`/api/posts/${post.id}`).set(auth(alice.token)).send({ image_url: null }).expect(200);
    expect(seen).toHaveLength(0);
    // A clean edit is saved
    expect((await api().put(`/api/posts/${post.id}`).set(auth(alice.token)).send({ content: 'Workshop was great!' })).status).toBe(200);
  });
});

describe('comments', () => {
  let post;
  beforeAll(async () => {
    post = await createPost(bob.token, 'A post to comment on');
  });

  test('2. a normal comment is saved', async () => {
    expect((await comment(alice.token, post.id, 'Great point, thanks for sharing!')).status).toBe(201);
  });

  test('4. an inappropriate comment is refused with a suggestion, not saved, and does not notify the post owner', async () => {
    const before = await Comment.count();
    const res = await comment(alice.token, post.id, 'What an idiot take');
    expectBlocked(res, 'PERSONAL_ABUSE', 'comment');
    expect(res.body.suggestedText).toBeTruthy();
    expect(await Comment.count()).toBe(before);
    const notifications = await api().get('/api/notifications').set(auth(bob.token));
    expect(notifications.body.notifications.some((n) => n.message.includes('idiot'))).toBe(false);
  });

  test('the example from the spec: flagged words, reason and a suggestion; applying it saves the comment', async () => {
    setModerationEngine(async (text) => {
      seen.push(text);
      if (text === 'That person is a stupid idiot and knows nothing.') {
        return { allowed: false, category: 'PERSONAL_ABUSE', flagged_words: ['stupid idiot'], reason: 'The comment contains personal insults.', suggested_text: "I strongly disagree with that person's opinion.", language: 'English' };
      }
      return fakeModeration(text);
    });
    const before = await Comment.count();
    const refused = await comment(alice.token, post.id, 'That person is a stupid idiot and knows nothing.');
    expectBlocked(refused, 'PERSONAL_ABUSE', 'comment');
    expect(refused.body).toMatchObject({ flaggedWords: ['stupid idiot'], reason: 'The comment contains personal insults.', suggestedText: "I strongly disagree with that person's opinion." });
    expect(refused.body.moderation.flagged_terms).toEqual([{ text: 'stupid idiot', start: 17, end: 29, category: 'PERSONAL_ABUSE' }]);
    expect(await Comment.count()).toBe(before);

    const saved = await comment(alice.token, post.id, refused.body.suggestedText);
    expect(saved.status).toBe(201);
    expect(saved.body.comment.content).toBe("I strongly disagree with that person's opinion.");
  });

  test('12. a resubmitted comment that is still inappropriate is refused again with a new suggestion', async () => {
    const first = await comment(alice.token, post.id, 'You are an idiot and a damn fool');
    expectBlocked(first, 'PERSONAL_ABUSE', 'comment');
    // The user only removed one of the words
    const second = await comment(alice.token, post.id, 'You are a damn fool');
    expectBlocked(second, 'MILD_PROFANITY', 'comment');
    expect(second.body.flaggedWords).toEqual(['damn']);
    expect(second.body.suggestedText).toBeTruthy();
    expect(second.body.suggestedText).not.toBe(first.body.suggestedText);
  });

  test('6. editing a comment is moderated and the original kept when refused', async () => {
    const created = (await comment(alice.token, post.id, 'Nice photo!')).body.comment;
    const res = await api().put(`/api/comments/${created.id}`).set(auth(alice.token)).send({ content: 'Nice photo, idiot' });
    expectBlocked(res, 'PERSONAL_ABUSE', 'comment');
    expect((await Comment.findByPk(created.id)).content).toBe('Nice photo!');
    expect((await api().put(`/api/comments/${created.id}`).set(auth(bob.token)).send({ content: 'x' })).status).toBe(403);
  });

  test('13. direct API calls cannot bypass comment moderation (allowed: true, moderation, headers)', async () => {
    const before = await Comment.count();
    for (const extra of [{ allowed: true }, { moderation: { allowed: true, blocked: false } }]) {
      const res = await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).send({ content: 'you idiot', ...extra });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Unknown fields/);
    }
    const created = (await comment(alice.token, post.id, 'Fine comment')).body.comment;
    const edit = await api().put(`/api/comments/${created.id}`).set(auth(alice.token)).send({ content: 'you idiot', allowed: true });
    expect(edit.status).toBe(400);
    const header = await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).set('X-Moderation-Passed', 'true').send({ content: 'you idiot' });
    expectBlocked(header, 'PERSONAL_ABUSE', 'comment');
    expect(await Comment.count()).toBe(before + 1); // only "Fine comment"
  });

  test('14. Ollama unavailable while commenting: 503, nothing saved, the user can retry', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setModerationEngine(async () => { throw Object.assign(new Error('unreachable'), { code: 'UNREACHABLE' }); });
      const before = await Comment.count();
      const res = await comment(alice.token, post.id, 'A normal comment while the model is down');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('MODERATION_UNAVAILABLE');
      expect(await Comment.count()).toBe(before);
      useFakeModeration();
      expect((await comment(alice.token, post.id, 'A normal comment while the model is down')).status).toBe(201);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('Recheck comment (moderate-content with kind=comment) uses the comment wording', async () => {
    const res = await api().post('/api/ai/moderate-content').set(auth(alice.token)).send({ content: 'you idiot', kind: 'comment' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ allowed: false, message: BLOCKED_COMMENT_MESSAGE });
    expect((await api().post('/api/ai/moderate-content').set(auth(alice.token)).send({ content: 'x', kind: 'tweet' })).status).toBe(400);
  });
});

describe('10. bypass and trust', () => {
  test('client-supplied moderation results are rejected and direct API calls are moderated', async () => {
    const forged = await api().post('/api/posts').set(auth(alice.token)).send({ content: 'kill you', moderation: { allowed: true } });
    expect(forged.status).toBe(400);
    expect(forged.body.message).toMatch(/Unknown fields: moderation/);

    const direct = await api().post('/api/posts').set(auth(alice.token)).set('X-Moderation-Passed', 'true').send({ content: 'I will kill you' });
    expectBlocked(direct, 'THREAT');
  });

  test('model answers are validated: invented flagged words are dropped, inconsistent answers block', async () => {
    setModerationEngine(async () => ({ allowed: false, category: 'PERSONAL_ABUSE', flagged_words: ['not in the text'], reason: '', suggested_text: '', language: 'English' }));
    const invented = await publish(alice.token, 'A completely different sentence');
    expect(invented.status).toBe(422);
    expect(invented.body.flaggedWords).toEqual([]);
    expect(invented.body.reason).toBe('The content insults or demeans a person.');

    setModerationEngine(async () => ({ allowed: true, category: 'THREAT', flagged_words: [], reason: '', suggested_text: '', language: 'English' }));
    expect((await publish(alice.token, 'Another sentence')).status).toBe(422);
  });

  test('15. a suggestion that is itself inappropriate is not offered (it is checked before it is shown)', async () => {
    setModerationEngine(async (text) => {
      seen.push(text);
      if (text === 'You fool') return { allowed: false, category: 'PERSONAL_ABUSE', flagged_words: ['fool'], reason: 'Insult.', suggested_text: 'You moron', language: 'English' };
      if (text === 'You moron') return { allowed: false, category: 'PERSONAL_ABUSE', flagged_words: ['moron'], reason: 'Insult.', suggested_text: '', language: 'English' };
      return fakeModeration(text);
    });
    const res = await publish(alice.token, 'You fool');
    expectBlocked(res, 'PERSONAL_ABUSE');
    expect(res.body.suggestedText).toBeNull();
    expect(seen).toEqual(['You fool', 'You moron']);
  });

  test('an offered suggestion was already checked, so publishing it does not run the model again', async () => {
    const refused = await publish(alice.token, 'What an idiot idea');
    expect(refused.body.suggestedText).toBeTruthy();
    const before = seen.length;
    expect((await publish(alice.token, refused.body.suggestedText)).status).toBe(201);
    expect(seen.length).toBe(before);
  });

  test('a suggestion that still contains a flagged word is not offered', async () => {
    setModerationEngine(async () => ({ allowed: false, category: 'PERSONAL_ABUSE', flagged_words: ['idiot'], reason: 'Insult.', suggested_text: 'You idiot, please stop.', language: 'English' }));
    const res = await publish(alice.token, 'You idiot');
    expect(res.status).toBe(422);
    expect(res.body.suggestedText).toBeNull();
  });

  test('the response does not expose model internals or configuration', async () => {
    const res = await publish(alice.token, 'This fucking traffic');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/11434|OLLAMA|ollama/);
    expect(res.body.moderation).not.toHaveProperty('model');
  });

  test('POST /api/ai/moderate-content runs the same check (with suggestion) without saving', async () => {
    const before = await Post.count();
    const res = await api().post('/api/ai/moderate-content').set(auth(alice.token)).send({ content: 'damn this' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ decision: 'block', allowed: false, category: 'MILD_PROFANITY', flaggedWords: ['damn'], message: BLOCKED_MESSAGE });
    expect(res.body.data.suggestedText).toBe('this');
    expect(await Post.count()).toBe(before);
    const clean = await api().post('/api/ai/moderate-content').set(auth(alice.token)).send({ content: 'Lovely day' });
    expect(clean.body.data).toMatchObject({ allowed: true, category: 'CLEAN', suggestedText: null, message: 'Your content looks good.' });
  });

  test('checking and then publishing the same text asks the model once', async () => {
    const text = `Unique text for the cache ${Date.now()}`;
    await api().post('/api/ai/moderate-content').set(auth(alice.token)).send({ content: text }).expect(200);
    await publish(alice.token, text).expect(201);
    expect(seen.filter((t) => t === text)).toHaveLength(1);
  });
});

describe('11. AI model unavailable (fail closed)', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    setOllamaTransport(null);
  });

  const unreachable = Object.assign(new Error('Ollama is not reachable at http://localhost:11434 (ECONNREFUSED)'), { code: 'UNREACHABLE' });
  test.each([
    ['Ollama unreachable', async () => { throw unreachable; }, 503],
    ['model not pulled', async () => { throw Object.assign(new Error('Model "x" is not available'), { code: 'MODEL_NOT_FOUND' }); }, 503],
    ['timeout', async () => { throw Object.assign(new Error('Ollama did not answer'), { code: 'TIMEOUT' }); }, 504],
    ['invalid JSON from the model', async () => ({ unexpected: true }), 503],
  ])('%s: posts and comments are refused and nothing is saved', async (_, failure, status) => {
    setModerationEngine(failure);
    const post = await Post.findOne();
    const [posts, comments] = [await Post.count(), await Comment.count()];

    for (const res of [await publish(alice.token, 'A perfectly normal post'), await comment(alice.token, post.id, 'A perfectly normal comment')]) {
      expect(res.status).toBe(status);
      expect(res.body.code).toBe('MODERATION_UNAVAILABLE');
      expect(res.headers['retry-after']).toBeDefined();
      expect(JSON.stringify(res.body)).not.toMatch(/11434|ECONNREFUSED/);
    }
    expect([await Post.count(), await Comment.count()]).toEqual([posts, comments]);
    // A technical log line, never the content
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/\[ai\] moderation failed/);
    expect(logged).not.toMatch(/perfectly normal/);
  });

  test('without a fake: a real request to an unreachable Ollama is refused (503)', async () => {
    setModerationEngine(null);
    const saved = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9'; // nothing listens here
    try {
      const res = await publish(alice.token, 'A perfectly normal post');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('MODERATION_UNAVAILABLE');
    } finally {
      process.env.OLLAMA_BASE_URL = saved;
    }
  });
});

describe('two users submitting independently', () => {
  test('each submission is checked on its own and attributed to its author', async () => {
    const [a, b] = await Promise.all([publish(alice.token, 'Morning run done, feeling great.'), publish(bob.token, 'Tu ekdum chutiya hai')]);
    expect(a.status).toBe(201);
    expect(a.body.post.author.id).toBe(alice.user.id);
    expectBlocked(b, 'PERSONAL_ABUSE');
    // Both texts were checked (plus the suggestion offered for the refused one)
    expect(seen).toEqual(expect.arrayContaining(['Morning run done, feeling great.', 'Tu ekdum chutiya hai']));
    expect(seen).toContain(b.body.suggestedText);
  });
});
