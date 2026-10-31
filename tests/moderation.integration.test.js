// Integration test with the REAL local moderation service (ai-moderation, FastAPI on 127.0.0.1).
// Opt-in, because it needs the Python service running:
//   npm run moderation            (terminal 1)
//   MODERATION_INTEGRATION=1 npm test -- tests/moderation.integration.test.js   (terminal 2)
import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { setModerationTransport, moderationHealth } from '../src/services/moderationClient.js';
import { useFakeModeration } from './mockModeration.js';

const enabled = process.env.MODERATION_INTEGRATION === '1';
const run = enabled ? describe : describe.skip;

run('real local moderation model (end to end)', () => {
  let alice;
  let bob;
  let post;

  beforeAll(async () => {
    setModerationTransport(null); // use the real HTTP service
    const health = await moderationHealth();
    if (!health.available) throw new Error('Moderation service is not running. Start it with: npm run moderation');
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

  test('comments: clean saved, vulgar blocked, edit to vulgar blocked', async () => {
    const ok = await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).send({ content: 'Beautiful views, thanks for sharing!' });
    expect(ok.status).toBe(201);
    const bad = await api().post(`/api/posts/${post.id}/comments`).set(auth(alice.token)).send({ content: 'What a fucking joke' });
    expect(bad.status).toBe(422);
    const edit = await api().put(`/api/comments/${ok.body.comment.id}`).set(auth(alice.token)).send({ content: 'Beautiful views, you moron' });
    expect(edit.status).toBe(422);
  });
});
