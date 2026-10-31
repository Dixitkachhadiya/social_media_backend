import { LEET, NON_WS_CLASS, SECOND_PERSON, codePointLength, normalize } from './normalize.js';

/**
 * Word/phrase list matching with positions in the ORIGINAL text (used to highlight offending terms),
 * ported 1:1 from ai-moderation/preprocessing/lexicon.py. Positions are JavaScript (UTF-16) indices,
 * the same values the Python service returned after utf16_offset().
 *
 * - A term matches when its normalized tokens appear as consecutive tokens of the text.
 * - Tokens are compared by a key that squeezes repeated letters (fuuuck -> fuck) unless fewer than
 *   4 characters would remain (so "ass" never matches "as").
 * - Masked words ("s*it", "d1ck*ead", "f**k") match through a wildcard: each run of * = 1-2 letters.
 * - Runs of 4+ single letters ("f u c k") are merged.
 * - Context-dependent terms (dog, owl, brother-in-law...) only count when the text addresses someone
 *   directly or the classifier is already confident the text is toxic.
 */

const SQUEEZE = /(.)\1+/gsu;
const RAW_TOKEN = new RegExp(`${NON_WS_CLASS}+`, 'g');
const SINGLE_LATIN = /^[a-z]$/;
const EDGE_PUNCT = new Set('.,;:?!"\'()[]{}\u2026\u0964\u0965\u201c\u201d\u2018\u2019-');
export const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3 };

export const tokenKey = (token) => {
  const squeezed = token.replace(SQUEEZE, '$1');
  return codePointLength(squeezed) >= 4 ? squeezed : token;
};

const maskPattern = (raw) => {
  const word = Array.from(raw.normalize('NFKC').toLowerCase(), (ch) => LEET[ch] ?? ch).join('');
  if (!/[a-z]\*+|\*+[a-z]/.test(word) || !/^[a-z*]+$/.test(word)) return null;
  if (word.replace(/\*/g, '').length < 2) return null;
  return new RegExp(`^${word.replace(/\*+/g, '[a-z]{1,2}')}$`);
};

const leadingPunct = (raw) => {
  let i = 0;
  while (i < raw.length && EDGE_PUNCT.has(raw[i])) i += 1;
  return i;
};

const trailingPunct = (raw) => {
  let i = raw.length;
  while (i > 0 && EDGE_PUNCT.has(raw[i - 1])) i -= 1;
  return raw.length - i;
};

/** Tokens of the original text: { norm, start, end, key, pattern } */
export const tokenize = (text) => {
  const rawTokens = [];
  for (const m of text.matchAll(RAW_TOKEN)) {
    const raw = m[0];
    const lead = leadingPunct(raw);
    if (lead === raw.length) continue;
    const start = m.index + lead;
    const end = m.index + raw.length - trailingPunct(raw);
    const pattern = maskPattern(text.slice(start, end));
    const parts = normalize(raw).split(' ').filter(Boolean);
    for (const part of parts) rawTokens.push([part, start, end, parts.length === 1 ? pattern : null]);
  }

  const merged = [];
  let i = 0;
  while (i < rawTokens.length) {
    let j = i;
    while (j < rawTokens.length && SINGLE_LATIN.test(rawTokens[j][0])) j += 1;
    if (j - i >= 4) {
      const norm = rawTokens.slice(i, j).map((t) => t[0]).join('');
      merged.push({ norm, start: rawTokens[i][1], end: rawTokens[j - 1][2], key: tokenKey(norm), pattern: null });
      i = j;
    } else {
      const [norm, start, end, pattern] = rawTokens[i];
      merged.push({ norm, start, end, key: tokenKey(norm), pattern });
      i += 1;
    }
  }
  return merged;
};

export const compileLexicon = (entries) => {
  const compiled = [];
  for (const e of entries) {
    const norms = normalize(e.term).split(' ').filter(Boolean);
    if (norms.length) compiled.push({ ...e, norms, keys: norms.map(tokenKey) });
  }
  // Longer phrases first so "fuck you" wins over "fuck" at the same position (stable sort, as in Python)
  return compiled.sort((a, b) => b.keys.length - a.keys.length);
};

export const isAddressed = (tokens) => tokens.some((t) => SECOND_PERSON.has(t.norm));

/** Returns [{ entry, start, end, text }], non-overlapping, ordered by position. */
export const findMatches = (text, compiled, pToxic = 0, contextThreshold = 0.7) => {
  const tokens = tokenize(text);
  const addressed = isAddressed(tokens);
  const used = new Array(tokens.length).fill(false);
  const matches = [];
  for (const entry of compiled) {
    if (entry.context_dependent && !(addressed || pToxic >= contextThreshold)) continue;
    const n = entry.keys.length;
    for (let i = 0; i <= tokens.length - n; i += 1) {
      let ok = true;
      for (let k = 0; k < n; k += 1) {
        const tok = tokens[i + k];
        const same = tok.key === entry.keys[k] || (tok.pattern !== null && tok.pattern.test(entry.norms[k]));
        if (used[i + k] || !same) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let k = 0; k < n; k += 1) used[i + k] = true;
      const start = tokens[i].start;
      const end = tokens[i + n - 1].end;
      matches.push({ entry, start, end, text: text.slice(start, end) });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
};
