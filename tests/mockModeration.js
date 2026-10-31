// Mocked moderation for automated tests: same result shape as the local model (src/ai/moderation/moderator.js),
// decided by a tiny fixed word list instead of the real model.
// The real model is exercised separately by tests/moderation.integration.test.js and tests/aiModel.test.js.
import { setModerationEngine } from '../src/services/moderationService.js';

const FAKE_TERMS = [
  ['jaan se maar', 'THREAT', 'high'],
  ['kill you', 'THREAT', 'high'],
  ['nobody wants you', 'HARASSMENT', 'high'],
  ['vermin', 'HATE_SPEECH', 'high'],
  ['fucking', 'VULGAR', 'medium'],
  ['chutiya', 'PERSONAL_ABUSE', 'medium'],
  ['चूतिया', 'PERSONAL_ABUSE', 'medium'],
  ['નાલાયક', 'PERSONAL_ABUSE', 'medium'],
  ['nalayak', 'PERSONAL_ABUSE', 'medium'],
  ['idiot', 'PERSONAL_ABUSE', 'medium'],
  ['damn', 'MILD_PROFANITY', 'low'],
];
const RANK = { low: 1, medium: 2, high: 3 };
const LABELS = {
  CLEAN: 'Clean', MILD_PROFANITY: 'Mild profanity', VULGAR: 'Vulgar language', PERSONAL_ABUSE: 'Personal abuse',
  HARASSMENT: 'Harassment', HATE_SPEECH: 'Hate speech', THREAT: 'Threatening language',
};

export const fakeModeration = (text) => {
  const lower = text.toLowerCase();
  const flagged = [];
  for (const [term, category, severity] of FAKE_TERMS) {
    const start = lower.indexOf(term);
    if (start >= 0) flagged.push({ text: text.slice(start, start + term.length), start, end: start + term.length, category, severity });
  }
  const uncertain = lower.includes('[uncertain]');
  const strongest = flagged.sort((a, b) => RANK[b.severity] - RANK[a.severity])[0];
  const decision = strongest ? 'block' : uncertain ? 'uncertain' : 'allow';
  const category = strongest?.category ?? (uncertain ? 'PERSONAL_ABUSE' : 'CLEAN');
  return {
    decision,
    blocked: decision !== 'allow',
    is_toxic: decision === 'block' ? true : decision === 'uncertain' ? null : false,
    category,
    category_label: LABELS[category],
    severity: strongest?.severity ?? (uncertain ? 'medium' : 'none'),
    confidence: decision === 'allow' ? 0.97 : 0.95,
    detected_language: /[ऀ-ॿ]/.test(text) ? 'Hindi' : /[઀-૿]/.test(text) ? 'Gujarati' : 'English',
    language_code: 'en',
    flagged_terms: flagged.sort((a, b) => a.start - b.start).map(({ severity, ...f }) => f),
    explanation: decision === 'allow' ? 'No inappropriate language was detected.' : 'Test moderation result.',
    signals: strongest ? ['word_list'] : [],
    model: { name: 'fake-test-model', version: 'test' },
    latency_ms: 0,
  };
};

export const useFakeModeration = () => setModerationEngine(async (text) => fakeModeration(text));
