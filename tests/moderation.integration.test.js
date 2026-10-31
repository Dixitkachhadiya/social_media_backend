// End-to-end test with the REAL local moderation model, running inside the Node.js process
// (src/ai/moderation): every post/comment save goes through it; nothing is mocked.
import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { setModerationEngine, moderationHealth } from '../src/services/moderationService.js';
import { useFakeModeration } from './mockModeration.js';

describe('real local moderation model (end to end)', () => {
  let alice;
  let bob;
  let post;

  beforeAll(async () => {
    setModerationEngine(null); // use the real model
    const health = moderationHealth();
    if (!health.available) throw new Error('The moderation model could not be loaded');
    await resetDatabase();
    alice = await createUser();
    bob = await createUser();
    post = await createPost(bob.token, 'Sharing photos from our weekend trip to the hills.');
    if (!post) throw new Error('A clean post was refused by the real model');
  });
  afterAll(async () => {
    useFakeModeration();
    await closeDatabase();
  });

  test.each([
    ['clean English', 'Had a great time at the conference today, learned a lot!'],
    ['clean criticism', 'The service at this restaurant was slow and the food was cold.'],
  ])('%s post is published', async (_, content) => {
    expect((await api().post('/api/posts').set(auth(alice.token)).send({ content })).status).toBe(201);
  });

  test.each([
    ['vulgar English', 'This fucking traffic made me late again.'],
    ['Hindi', 'तू एकदम चूतिया है, सब खराब कर दिया।'],
    ['Gujarati', 'તું સાવ નાલાયક છે, કામ બગાડી નાખ્યું.'],
    ['Hinglish', 'Bro tu literally chutiya hai, pura plan kharab kar diya'],
    ['Hindi romanized threat', 'Kal college ke bahar mil, jaan se maar dunga'],
    ['Gujarati romanized', 'Tu sav nalayak che, project bagadi nakhyu'],
  ])('%s post is blocked with highlighted terms', async (_, content) => {
    const res = await api().post('/api/posts').set(auth(alice.token)).send({ content });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONTENT_MODERATION_FAILED');
    expect(res.body.moderation.flagged_terms.length).toBeGreaterThan(0);
    for (const f of res.body.moderation.flagged_terms) expect(content.slice(f.start, f.end)).toBe(f.text);
  });

  test('editing a post: clean edit saved, vulgar edit refused and the original kept', async () => {
    const ok = await api().put(`/api/posts/${post.id}`).set(auth(bob.token)).send({ content: 'Sharing photos from our weekend trip to the hills and the lake.' });
    expect(ok.status).toBe(200);
    const bad = await api().put(`/api/posts/${post.id}`).set(auth(bob.token)).send({ content: 'Sharing photos from this shitty weekend trip.' });
    expect(bad.status).toBe(422);
    const current = await api().get(`/api/posts/${post.id}`).set(auth(bob.token));
    expect(current.body.post.content).toBe('Sharing photos from our weekend trip to the hills and the lake.');
  });

  test('/api/moderation/status reports the in-process model', async () => {
    const res = await api().get('/api/moderation/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'available', engine: 'in-process', model: 'tfidf-char-logreg' });
  });

  test('comments: clean saved, vulgar blocked, edit to vulgar blocked', async () => {
    const ok = await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).send({ content: 'Beautiful views, thanks for sharing!' });
    expect(ok.status).toBe(201);
    const bad = await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).send({ content: 'What a fucking joke' });
    expect(bad.status).toBe(422);
    const edit = await api().put(`/api/comments/${ok.body.comment.id}`).set(auth(alice.token)).send({ content: 'Beautiful views, you moron' });
    expect(edit.status).toBe(422);
  });
});
