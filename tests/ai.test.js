// AI endpoints: local extractive summarization (no external AI provider, nothing mocked).
import { api, auth, resetDatabase, closeDatabase, createUser, createPost } from './helpers.js';
import { Post } from '../src/models/index.js';

const ARTICLE = [
  'Our city finally opened the new metro line last week.',
  'The line connects the airport to the main business district in just 25 minutes.',
  'Ticket prices start at 30 rupees, which is cheaper than a taxi.',
  'Some commuters complained that the stations are still missing escalators.',
  'The transport department says escalators will be installed by March.',
  'Overall, most riders I spoke to are happy with the faster commute.',
].join(' ');

let user;

beforeAll(async () => {
  await resetDatabase();
  user = await createUser();
});
afterAll(closeDatabase);

const summarize = (body, token = user.token) => api().post('/api/ai/summarize').set(auth(token)).send(body);

describe('removed Gemini endpoints', () => {
  test.each(['/api/ai/generate-post', '/api/ai/improve-post'])('%s no longer exists', async (path) => {
    expect((await api().post(path).set(auth(user.token)).send({ topic: 'x', content: 'x' })).status).toBe(404);
  });
});

describe('POST /api/ai/summarize { content }', () => {
  test('requires authentication', async () => {
    expect((await api().post('/api/ai/summarize').send({ content: ARTICLE })).status).toBe(401);
  });

  test.each(['short', 'medium', 'detailed'])('%s summary: shorter, made only of original sentences, nothing published', async (length) => {
    const postsBefore = await Post.count();
    const res = await summarize({ content: ARTICLE, length });

    expect(res.status).toBe(200);
    const { summary, summary_length: summaryLength, original_length: originalLength, sentences_selected: selected } = res.body.data;
    expect(summaryLength).toBeLessThan(originalLength);
    expect(selected).toBeGreaterThanOrEqual(1);
    // Extractive: every summary sentence appears verbatim in the input (no invented content)
    for (const sentence of summary.match(/[^.!?]+[.!?]/g)) expect(ARTICLE).toContain(sentence.trim());
    expect(res.body.meta).toMatchObject({ ai_generated: true, method: 'extractive', published: false });
    expect(await Post.count()).toBe(postsBefore);
  });

  test('longer lengths never give a shorter summary', async () => {
    const lengths = [];
    for (const length of ['short', 'medium', 'detailed']) lengths.push((await summarize({ content: ARTICLE, length })).body.data.summary_length);
    expect(lengths[0]).toBeLessThanOrEqual(lengths[1]);
    expect(lengths[1]).toBeLessThanOrEqual(lengths[2]);
  });

  test('Hindi, Gujarati and Hinglish text keep their script and sentences', async () => {
    const texts = [
      'आज शहर में नई मेट्रो लाइन शुरू हुई। यह लाइन हवाई अड्डे को बाजार से जोड़ती है। टिकट की कीमत तीस रुपये से शुरू होती है। कुछ यात्रियों ने कहा कि स्टेशनों पर अभी लिफ्ट नहीं है।',
      'આજે શહેરમાં નવી મેટ્રો લાઇન શરૂ થઈ. આ લાઇન એરપોર્ટને બજાર સાથે જોડે છે. ટિકિટની કિંમત ત્રીસ રૂપિયાથી શરૂ થાય છે. કેટલાક મુસાફરોએ કહ્યું કે સ્ટેશન પર હજી લિફ્ટ નથી.',
      'Kal hum log Lonavala trip pe gaye the. Weather ekdum mast tha aur baarish bhi ho rahi thi. Raste mein traffic bahut zyada tha, almost 3 ghante lag gaye. Next time hum early morning nikalenge.',
    ];
    for (const content of texts) {
      const res = await summarize({ content, length: 'short' });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.length).toBeLessThan(content.length);
      expect(content).toContain(res.body.data.summary.split(/(?<=[.।])\s/)[0]);
    }
  });

  test('text that is too short is refused with a clear message', async () => {
    const res = await summarize({ content: 'Nice weather today. Loving it!' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'TEXT_TOO_SHORT' });
    expect(res.body.message).toMatch(/too short to summarize/);
  });

  test('empty, too long and invalid input is rejected', async () => {
    expect((await summarize({ content: '   ' })).status).toBe(400);
    expect((await summarize({ content: 'x '.repeat(2600) })).status).toBe(400);
    expect((await summarize({ content: ARTICLE, length: 'huge' })).status).toBe(400);
    expect((await summarize({})).status).toBe(400);
  });

  test('a long text at the maximum length is summarized quickly', async () => {
    let content = '';
    for (let i = 0; content.length < 4900; i += 1) content += `Point ${i} about topic ${i % 7} explains detail number ${i}. `;
    const started = Date.now();
    const res = await summarize({ content: content.slice(0, 5000), length: 'detailed' });
    expect(res.status).toBe(200);
    expect(res.body.data.sentences_selected).toBeLessThanOrEqual(7);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('POST /api/ai/summarize { postId }', () => {
  test('handles posts without comments', async () => {
    const post = await createPost(user.token, 'Quiet post');
    const res = await summarize({ postId: post.id });

    expect(res.status).toBe(200);
    expect(res.body.data.comments_total).toBe(0);
    expect(res.body.meta.ai_generated).toBe(false);
  });

  test('summarizes a post and its comments with quoted, attributed points', async () => {
    const post = await createPost(user.token, 'Should our college make attendance optional for final-year students? It would help with internships.');
    const ravi = await createUser();
    const meera = await createUser();
    const comments = [
      [ravi, 'Yes! Internships matter more in the final year than lectures.'],
      [meera, 'Optional attendance could hurt students who need structure.'],
      [ravi, 'Maybe make it optional only for students with an internship offer letter.'],
    ];
    for (const [author, content] of comments) {
      expect((await api().post(`/api/posts/${post.id}/comments`).set(auth(author.token)).send({ content })).status).toBe(201);
    }

    const res = await summarize({ postId: post.id });
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toMatchObject({ comments_total: 3, comments_included: 3 });
    expect(data.summary).toContain(`Post by ${user.user.username}:`);
    expect(data.summary).toContain('3 comments by 2 people');
    expect(data.points.length).toBeGreaterThan(0);
    const authors = { [ravi.user.username]: comments.filter(([a]) => a === ravi).map(([, c]) => c), [meera.user.username]: [comments[1][1]] };
    for (const point of data.points) expect(authors[point.author].some((c) => c.includes(point.text))).toBe(true);
  });

  test('returns 404 for missing or hidden posts and 400 for invalid IDs', async () => {
    const hiddenAuthor = await createUser();
    const hidden = await createPost(hiddenAuthor.token, 'hidden');
    await hiddenAuthor.user.update({ is_active: false });

    expect((await summarize({ postId: hidden.id })).status).toBe(404);
    expect((await summarize({ postId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await summarize({ postId: 'abc' })).status).toBe(400);
  });
});
