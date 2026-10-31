/**
 * Text normalization, ported 1:1 from ai-moderation/preprocessing/normalize.py (the model was trained on
 * text normalized by the Python version; tests/aiParity.test.js checks both give the same output).
 * Devanagari and Gujarati are kept as they are; only Latin text is lower-cased and de-obfuscated
 * (leet digits, f*ck, f u c k, repeated letters, zero-width characters).
 *
 * Python iterates and counts code points, JavaScript strings are UTF-16: per-character work below
 * iterates code points (for...of / the u flag) so astral characters behave the same.
 */

const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff]/g;
export const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const HAS_LATIN = /[a-z]/;
// The explicit whitespace class shared with Python (its \s and JavaScript's \s differ slightly)
export const WS = ' \t\n\r\f\v\u1680\u2028\u2029';
const WS_SET = new Set(WS);
const WS_CLASS = '[ \\t\\n\\r\\f\\v\\u1680\\u2028\\u2029]';
export const NON_WS_CLASS = '[^ \\t\\n\\r\\f\\v\\u1680\\u2028\\u2029]';
const TOKEN = new RegExp(`${NON_WS_CLASS}+`, 'g');
// "f*ck" -> "fck" (stars between Latin letters)
const STAR_BETWEEN_LETTERS = /(?<=[a-z])\*+(?=[a-z])/g;
// "f u c k", "b.h.e.n" -> joined when 4+ single Latin letters are separated by spaces . - _
const SPACED_LETTERS = new RegExp(`(?<!${NON_WS_CLASS})(?:[a-z][ .\\-_]+){3,}[a-z](?!${NON_WS_CLASS})`, 'g');
const SPACED_SEPARATORS = /[ .\-_]+/g;
const REPEATS = /(.)\1{2,}/gsu;
const WHITESPACE = new RegExp(`${WS_CLASS}+`, 'g');
// Letters, combining marks (Hindi/Gujarati vowel signs) and numbers are kept
const KEPT = /^[\p{L}\p{M}\p{N}]$/u;

const leetToken = (token) => (HAS_LATIN.test(token) ? Array.from(token, (ch) => LEET[ch] ?? ch).join('') : token);

export const normalize = (text) => {
  let t = (text || '').normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase();
  t = t.replace(TOKEN, leetToken);
  t = t.replace(STAR_BETWEEN_LETTERS, '');
  t = t.replace(SPACED_LETTERS, (m) => m.replace(SPACED_SEPARATORS, ''));
  let kept = '';
  for (const ch of t) kept += WS_SET.has(ch) || KEPT.test(ch) ? ch : ' ';
  return kept.replace(REPEATS, '$1$1').replace(WHITESPACE, ' ').replace(/^ +| +$/g, '');
};

// Words addressing a person directly (used to decide whether a context-dependent word is abusive)
export const SECOND_PERSON = new Set([
  'you', 'your', 'youre', 'yours', 'u', 'ur', 'yourself',
  'tu', 'tum', 'tujhe', 'tera', 'teri', 'tere', 'tumhara', 'tumhare', 'tumhe', 'aap',
  'tame', 'tane', 'taro', 'tari', 'taru', 'tamne', 'tamaro', 'tamari', 'tara',
  'abe', 'oye', 'ae', 'saale',
  'तू', 'तुम', 'तुझे', 'तेरा', 'तेरी', 'तेरे', 'तुम्हारा', 'तुम्हें',
  'તું', 'તમે', 'તને', 'તારો', 'તારી', 'તારું', 'તમારો', 'તમને',
]);

// Length in code points (Python len)
export const codePointLength = (s) => {
  let n = 0;
  for (const _ of s) n += 1; // eslint-disable-line no-unused-vars
  return n;
};
