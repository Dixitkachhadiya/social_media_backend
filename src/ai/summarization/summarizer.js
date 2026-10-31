import { contentTokens, countWords, splitSentences } from './text.js';

/**
 * Local extractive summarization (no external AI, no model download). The summary consists only of
 * sentences taken unchanged from the input, so it cannot invent facts; it works for any language/script.
 *
 * Method (TextRank): sentences are compared by TF-IDF cosine similarity of their content words; a
 * PageRank over that similarity graph scores how central each sentence is. The best-scoring sentences
 * that fit the length budget are kept in their original order, skipping near-duplicates.
 */

export const SUMMARIZER = { method: 'extractive', name: 'textrank-tfidf' };

// Budget per requested length: at most maxWords and ratio x the original length, at most maxSentences
export const SUMMARY_LENGTHS = {
  short: { maxWords: 40, ratio: 0.3, maxSentences: 2 },
  medium: { maxWords: 90, ratio: 0.45, maxSentences: 4 },
  detailed: { maxWords: 160, ratio: 0.65, maxSentences: 7 },
};
export const MIN_SENTENCES = 2;
export const MIN_WORDS = 20;
const MAX_SENTENCES = 400; // bounds the O(n^2) similarity graph for very long input
const DAMPING = 0.85;
const REDUNDANT = 0.6; // cosine similarity above which two sentences say the same thing
const LEAD_BONUS = 0.15; // posts usually state their point first

// ---------- vectors ----------

const tfidfVectors = (tokenLists) => {
  const df = new Map();
  for (const tokens of tokenLists) for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  const n = tokenLists.length;
  return tokenLists.map((tokens) => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    let norm = 0;
    for (const [t, count] of tf) {
      const w = (1 + Math.log(count)) * (Math.log((1 + n) / (1 + df.get(t))) + 1);
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm) for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  });
};

const cosine = (a, b) => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [t, w] of small) {
    const v = large.get(t);
    if (v) s += w * v;
  }
  return s;
};

// Weighted PageRank over the sentence similarity graph
const textRank = (vectors) => {
  const n = vectors.length;
  const sim = vectors.map((a, i) => vectors.map((b, j) => (i === j ? 0 : cosine(a, b))));
  const outWeight = sim.map((row) => row.reduce((x, y) => x + y, 0));
  let scores = new Array(n).fill(1 / n);
  for (let iter = 0; iter < 100; iter += 1) {
    const next = new Array(n).fill((1 - DAMPING) / n);
    for (let j = 0; j < n; j += 1) {
      if (!outWeight[j]) {
        // A sentence that shares no words with any other spreads its score evenly
        for (let i = 0; i < n; i += 1) next[i] += (DAMPING * scores[j]) / n;
        continue;
      }
      for (let i = 0; i < n; i += 1) if (sim[j][i]) next[i] += (DAMPING * scores[j] * sim[j][i]) / outWeight[j];
    }
    const delta = next.reduce((d, v, i) => d + Math.abs(v - scores[i]), 0);
    scores = next;
    if (delta < 1e-8) break;
  }
  return { scores, sim };
};

/**
 * Picks sentences by score within the budget. candidates: [{ index, words, score }].
 * Returns the chosen indices in original order.
 */
const select = (candidates, sim, { maxWords, maxSentences }) => {
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  let words = 0;
  for (const c of ranked) {
    if (chosen.length >= maxSentences) break;
    if (words + c.words > maxWords && chosen.length) continue;
    if (!chosen.length && c.words > maxWords * 2 && ranked.some((o) => o.words <= maxWords)) continue;
    if (chosen.some((o) => sim[o.index][c.index] > REDUNDANT)) continue;
    chosen.push(c);
    words += c.words;
  }
  if (!chosen.length) chosen.push(ranked[0]);
  return chosen.map((c) => c.index).sort((a, b) => a - b);
};

// ---------- text ----------

/**
 * Summarizes text. Returns { summary, sentences_total, sentences_selected }, or { tooShort: true }
 * when there is nothing to shorten (fewer than 2 sentences or 20 words).
 */
export const summarizeText = (content, length = 'medium') => {
  const budget = SUMMARY_LENGTHS[length];
  const sentences = splitSentences(content).slice(0, MAX_SENTENCES);
  const totalWords = sentences.reduce((n, s) => n + s.words, 0);
  if (sentences.length < MIN_SENTENCES || totalWords < MIN_WORDS) return { tooShort: true };

  const vectors = tfidfVectors(sentences.map((s) => contentTokens(s.text)));
  const { scores, sim } = textRank(vectors);
  const candidates = sentences.map((s, index) => ({
    index,
    words: s.words,
    // Very short sentences ("Thanks!", "So true.") rarely carry the main point
    score: scores[index] * (index === 0 ? 1 + LEAD_BONUS : 1) * (s.words < 4 ? 0.5 : 1),
  }));
  const chosen = select(candidates, sim, {
    maxWords: Math.max(8, Math.min(budget.maxWords, Math.ceil(totalWords * budget.ratio))),
    // Always shorter than the original: never every sentence
    maxSentences: Math.min(budget.maxSentences, sentences.length - 1),
  });
  return {
    summary: chosen.map((i) => sentences[i].text).join(' '),
    sentences_total: sentences.length,
    sentences_selected: chosen.length,
  };
};

// ---------- discussion ----------

const MAX_POINTS = 4;
const MAX_QUOTED_WORDS = 35;
const POST_BUDGET = { maxWords: 45, maxSentences: 2 };

/**
 * Summarizes a post and its comments: the post's main point plus the most representative comment
 * sentences (central in the discussion and related to the post), quoted with their authors.
 * post: { author, content }, comments: [{ author, content }] in chronological order.
 */
export const summarizeDiscussion = ({ post, comments }) => {
  // Post: its most central sentence(s), or all of it when short
  const postSentences = splitSentences(post.content);
  let postSummary = post.content.trim();
  if (countWords(postSummary) > POST_BUDGET.maxWords && postSentences.length > 1) {
    const vectors = tfidfVectors(postSentences.map((s) => contentTokens(s.text)));
    const { scores, sim } = textRank(vectors);
    const candidates = postSentences.map((s, index) => ({ index, words: s.words, score: scores[index] * (index === 0 ? 1 + LEAD_BONUS : 1) }));
    postSummary = select(candidates, sim, POST_BUDGET).map((i) => postSentences[i].text).join(' ');
  }

  // Comments: a short comment is quoted whole (a lone sentence can lose its meaning, "But X too."),
  // a long one by its sentences; candidates are ranked by centrality and relevance to the post
  const units = [];
  comments.forEach((c, commentIndex) => {
    const text = c.content.replace(/\s+/g, ' ').trim();
    const words = countWords(text);
    const parts = words <= MAX_QUOTED_WORDS ? [{ text, words }] : splitSentences(c.content);
    for (const s of parts) units.push({ ...s, author: c.author, commentIndex });
  });
  const limited = units.slice(-MAX_SENTENCES);
  const tokenLists = limited.map((u) => contentTokens(u.text));
  const vectors = tfidfVectors([...tokenLists, contentTokens(post.content)]);
  const postVector = vectors.pop();
  const { scores, sim } = textRank(vectors);
  const maxScore = Math.max(...scores, Number.EPSILON);

  const ranked = limited
    .map((u, index) => ({
      ...u,
      index,
      informative: tokenLists[index].length >= 2,
      score: (0.7 * scores[index]) / maxScore + 0.3 * cosine(vectors[index], postVector),
    }))
    .sort((a, b) => b.informative - a.informative || b.score - a.score || a.index - b.index);

  // At most one sentence per comment, no near-duplicates
  const points = [];
  for (const u of ranked) {
    if (points.length >= Math.min(MAX_POINTS, comments.length)) break;
    if (points.some((p) => p.commentIndex === u.commentIndex || sim[p.index][u.index] > REDUNDANT)) continue;
    points.push(u);
  }
  points.sort((a, b) => a.index - b.index);

  const participants = new Set(comments.map((c) => c.author)).size;
  const lines = [
    `Post by ${post.author}: ${postSummary}`,
    '',
    `Key points from the discussion (${comments.length} comment${comments.length === 1 ? '' : 's'} by ${participants} ${participants === 1 ? 'person' : 'people'}):`,
    ...points.map((p) => `• ${p.author}: "${p.text}"`),
  ];
  return { summary: lines.join('\n'), points: points.map((p) => ({ author: p.author, text: p.text })) };
};
