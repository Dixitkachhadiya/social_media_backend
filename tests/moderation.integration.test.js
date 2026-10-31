// End-to-end test with the REAL Ollama model (nothing mocked): every post/comment save goes through it.
// Opt-in, because it needs Ollama running with OLLAMA_MODEL pulled (see README):
//   OLLAMA_INTEGRATION=1 npm test -- tests/moderation.integration.test.js
// CPU inference is slow, so the timeouts are generous.
import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { setModerationEngine } from '../src/services/moderationService.js';
import { ollamaHealth } from '../src/services/ollamaService.js';
import { useFakeModeration } from './mockModeration.js';

const run = process.env.OLLAMA_INTEGRATION === '1' ? describe : describe.skip;
const SLOW = 300000;

run('real Ollama moderation (end to end)', () => {
  let alice;
  let bob;
  let post;

  beforeAll(async () => {
    setModerationEngine(null); // use the real model
    const health = await ollamaHealth();
    if (!health.available) throw new Error(`Ollama is not ready (${health.reason}): ${health.detail}`);
    await resetDatabase();
    alice = await createUser();
    bob = await createUser();
    post = await createPost(bob.token, 'Sharing photos from our weekend trip to the hills.');
    if (!post) throw new Error('A clean post was refused by the real model');
  }, SLOW);
  afterAll(async () => {
    useFakeModeration();
    await closeDatabase();
  });

  test.each([
    ['clean English', 'Had a great time at the conference today, learned a lot!'],
    ['ordinary criticism', 'The service at this restaurant was slow and the food was cold.'],
    ['harmless joke', 'My code works and I have no idea why 😂'],
  ])('%s post is published', async (_, content) => {
    expect((await api().post('/api/posts').set(auth(alice.token)).send({ content })).status).toBe(201);
  }, SLOW);

  test.each([
    ['English insult', 'I hate this stupid person. He is an idiot.'],
    ['vulgar English', 'This fucking traffic made me late again.'],
    ['Hindi', 'तू एकदम कमीना है, सब खराब कर दिया।'],
    ['Gujarati', 'તું સાવ નાલાયક છે, કામ બગાડી નાખ્યું.'],
    ['Hinglish', 'Bro tu literally chutiya hai, pura plan kharab kar diya'],
    ['Hindi romanized threat', 'Kal college ke bahar mil, jaan se maar dunga'],
  ])('%s post is blocked with a suggestion', async (_, content) => {
    const res = await api().post('/api/posts').set(auth(alice.token)).send({ content });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONTENT_MODERATION_FAILED');
    for (const f of res.body.moderation.flagged_terms) expect(content.slice(f.start, f.end)).toBe(f.text);
  }, SLOW);

  test('applying the suggestion publishes the cleaned version', async () => {
    const refused = await api().post('/api/posts').set(auth(alice.token)).send({ content: 'I hate this stupid person. He is an idiot.' });
    expect(refused.status).toBe(422);
    expect(refused.body.suggestedText).toBeTruthy();
    expect((await api().post('/api/posts').set(auth(alice.token)).send({ content: refused.body.suggestedText })).status).toBe(201);
  }, SLOW);

  test('comments and edits are moderated', async () => {
    const ok = await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).send({ content: 'Beautiful views, thanks for sharing!' });
    expect(ok.status).toBe(201);
    expect((await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).send({ content: 'What a fucking joke' })).status).toBe(422);
    expect((await api().put(`/api/comments/${ok.body.comment.id}`).set(auth(alice.token)).send({ content: 'Beautiful views, you moron' })).status).toBe(422);
    expect((await api().put(`/api/posts/${post.id}`).set(auth(bob.token)).send({ content: 'Photos from this shitty trip.' })).status).toBe(422);
  }, SLOW);
});
