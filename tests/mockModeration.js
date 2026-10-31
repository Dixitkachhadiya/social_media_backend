// Mocked AI moderation for automated tests: returns the same JSON the Ollama model is asked for
// (allowed, category, flagged_words, reason, suggested_text, language), decided by a tiny fixed word list.
// The real validation (moderationService.interpret) still runs on it. The real model is exercised by
// tests/moderation.integration.test.js (opt-in) and "npm run ai:check".
import { setModerationEngine } from '../src/services/moderationService.js';

const FAKE_TERMS = [
  ['jaan se maar', 'THREAT'],
  ['kill you', 'THREAT'],
  ['nobody wants you', 'HARASSMENT'],
  ['vermin', 'HATE_SPEECH'],
  ['fucking', 'VULGAR'],
  ['chutiya', 'PERSONAL_ABUSE'],
  ['चूतिया', 'PERSONAL_ABUSE'],
  ['નાલાયક', 'PERSONAL_ABUSE'],
  ['nalayak', 'PERSONAL_ABUSE'],
  ['stupid', 'PERSONAL_ABUSE'],
  ['idiot', 'PERSONAL_ABUSE'],
  ['damn', 'MILD_PROFANITY'],
];
const RANK = ['MILD_PROFANITY', 'VULGAR', 'PERSONAL_ABUSE', 'HARASSMENT', 'HATE_SPEECH', 'THREAT'];

export const fakeModeration = (text) => {
  const lower = text.toLowerCase();
  const hits = FAKE_TERMS.filter(([term]) => lower.includes(term));
  if (!hits.length) return { allowed: true, category: 'CLEAN', flagged_words: [], reason: '', suggested_text: '', language: 'English' };
  const category = hits.map(([, c]) => c).sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0];
  let suggestion = text;
  for (const [term] of hits) suggestion = suggestion.replace(new RegExp(term, 'gi'), '').replace(/\s{2,}/g, ' ');
  return {
    allowed: false,
    category,
    // as written in the text, like the model is asked to
    flagged_words: hits.map(([term]) => text.slice(lower.indexOf(term), lower.indexOf(term) + term.length)),
    reason: 'Test moderation result.',
    suggested_text: suggestion.trim() || 'Let us keep this respectful.',
    language: /[ऀ-ॿ]/.test(text) ? 'Hindi' : /[઀-૿]/.test(text) ? 'Gujarati' : 'English',
  };
};

export const useFakeModeration = () => setModerationEngine(async (text) => fakeModeration(text));
