/**
 * Lightweight language identification for English, Hindi, Gujarati and their romanized / mixed forms,
 * ported 1:1 from ai-moderation/preprocessing/language.py.
 * Script detection is reliable; romanized Hindi vs Gujarati is a best guess from common function words.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const GUJARATI = /[઀-૿]/;
const LATIN_WORD = /[a-z]+/g;

const HINDI_HINTS = new Set(['hai', 'hain', 'nahi', 'nahin', 'kya', 'mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'tu', 'tum', 'mujhe',
  'tujhe', 'kar', 'karo', 'raha', 'rahi', 'gaya', 'gayi', 'ka', 'ki', 'ke', 'bhi', 'toh', 'aur', 'bahut', 'accha',
  'achha', 'abe', 'yaar', 'kal', 'sab', 'ho', 'tha', 'thi', 'diya', 'dunga', 'lunga', 'hoon', 'kyun', 'kaise']);
const GUJARATI_HINTS = new Set(['che', 'chhe', 'nathi', 'tame', 'tane', 'maru', 'taru', 'maro', 'taro', 'shu', 'kem', 'aaje', 'kale', 'bahu',
  'saru', 'saras', 'hatu', 'hati', 'hato', 'thai', 'gayu', 'gayo', 'karyu', 'pachhu', 'aavu', 'mane', 'ema',
  'ane', 'pan', 'sav', 'nakhish', 'kai', 'jay', 'chu']);
const ENGLISH_HINTS = new Set(['the', 'is', 'are', 'and', 'you', 'to', 'of', 'this', 'that', 'it', 'was', 'for', 'with', 'my', 'not', 'so',
  'what', 'but', 'have', 'just', 'please', 'thanks', 'today', 'really', 'honestly', 'i', 'me', 'we', 'they',
  'be', 'can', 'will', 'your', 'about']);

const NAMES = {
  en: 'English', hi: 'Hindi', gu: 'Gujarati', 'hi-Latn': 'Hindi (romanized)', 'gu-Latn': 'Gujarati (romanized)',
  hinglish: 'Hinglish (Hindi + English)', 'en-gu': 'Mixed (English + Gujarati)', mixed: 'Mixed language', unknown: 'Unknown',
};

/** Returns { code, name, reliable }. */
export const detectLanguage = (text) => {
  const hasDev = DEVANAGARI.test(text);
  const hasGuj = GUJARATI.test(text);
  const words = text.toLowerCase().match(LATIN_WORD) || [];
  const score = { en: 0, hi: 0, gu: 0 };
  for (const w of words) {
    score.en += ENGLISH_HINTS.has(w);
    score.hi += HINDI_HINTS.has(w);
    score.gu += GUJARATI_HINTS.has(w);
  }

  const components = [];
  if (hasDev) components.push('hi');
  if (hasGuj) components.push('gu');
  if (words.length) {
    if (score.hi > score.gu && score.hi > 0) components.push(score.en > 0 ? 'hinglish' : 'hi-Latn');
    else if (score.gu > 0) components.push(score.en > 0 ? 'en-gu' : 'gu-Latn');
    else components.push('en');
  }

  const code = components.length > 1 ? 'mixed' : components[0] || 'unknown';
  const name = components.length > 1 ? `Mixed (${components.map((c) => NAMES[c]).join(' + ')})` : NAMES[code];
  return { code, name, reliable: hasDev || hasGuj || words.length >= 3 };
};
