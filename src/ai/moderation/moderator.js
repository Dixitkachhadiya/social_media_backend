import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadClassifier } from './classifier.js';
import { normalize } from '../preprocessing/normalize.js';
import { SEVERITY_RANK, compileLexicon, findMatches, isAddressed, tokenize } from '../preprocessing/lexicon.js';
import { detectLanguage } from '../preprocessing/language.js';

/**
 * Local multilingual moderation running inside the Node.js process: trained classifier + word list +
 * publishing policy. Ported 1:1 from ai-moderation/inference/moderator.py (no external AI APIs, no
 * Python service). The model is loaded once per process; if loading fails, every check fails closed.
 *
 * Decisions
 *   allow      CLEAN content.
 *   block      Any of MILD_PROFANITY, VULGAR, PERSONAL_ABUSE, HARASSMENT, HATE_SPEECH, THREAT.
 *   uncertain  The model leans toward toxic but is below the block threshold and no listed word was
 *              found. Refused by the backend with a "please rephrase" message.
 * Texts under 3 words are judged by the word list only (model scores on very short text are unreliable).
 */

const MODEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'model');

export const LABELS = ['CLEAN', 'MILD_PROFANITY', 'VULGAR', 'PERSONAL_ABUSE', 'HARASSMENT', 'HATE_SPEECH', 'THREAT'];
const SERIOUS = new Set(['HARASSMENT', 'HATE_SPEECH', 'THREAT']);
const CATEGORY_SEVERITY = {
  CLEAN: 'none', MILD_PROFANITY: 'low', VULGAR: 'medium', PERSONAL_ABUSE: 'medium', HARASSMENT: 'high', HATE_SPEECH: 'high', THREAT: 'high',
};
const EXPLANATIONS = {
  MILD_PROFANITY: 'The text contains mild profanity.',
  VULGAR: 'The text contains vulgar or sexual language.',
  PERSONAL_ABUSE: 'The text insults or demeans a person.',
  HARASSMENT: 'The text harasses or degrades a person (including slurs or encouraging self-harm).',
  HATE_SPEECH: 'The text attacks or dehumanizes a group of people.',
  THREAT: 'The text threatens violence or harm.',
};
const DISPLAY = {
  MILD_PROFANITY: 'Mild profanity', VULGAR: 'Vulgar language', PERSONAL_ABUSE: 'Personal abuse', HARASSMENT: 'Harassment',
  HATE_SPEECH: 'Hate speech', THREAT: 'Threatening language', CLEAN: 'Clean',
};
const MIN_WORDS_FOR_MODEL = 3;
const SERIOUS_ESCALATION = 0.7;
const DEFAULT_THRESHOLDS = { block: 0.8, uncertain: 0.6 };
// Same input limit as the former Python service; posts and comments are shorter (validators)
export const MAX_CHARS = 10000;

const readJson = (file) => JSON.parse(readFileSync(path.join(MODEL_DIR, file), 'utf8'));

// First element with the highest key (Python max() keeps the first on ties)
const maxBy = (items, key) => items.reduce((best, item) => (key(item) > key(best) ? item : best));
const higherSeverity = (a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a);
// Python round(x, 3)
const round3 = (x) => Number(x.toFixed(3));

export const createModerator = ({ thresholds } = {}) => {
  const deployment = readJson('deployment.json');
  if (deployment.model !== 'baseline') throw new Error(`Unsupported deployed model: ${deployment.model}`);
  const classifier = loadClassifier(path.join(MODEL_DIR, 'classifier.json'));
  if ([...classifier.labels].sort().join() !== [...LABELS].sort().join()) {
    throw new Error(`Model labels ${classifier.labels} do not match ${LABELS}`);
  }
  const lexicon = compileLexicon(readJson('lexicon.json').entries);
  const limits = { ...DEFAULT_THRESHOLDS, ...deployment.thresholds, ...thresholds };
  const version = deployment.version || 'untuned';

  const moderate = (text) => {
    const started = performance.now();
    const normalized = normalize(text);
    const words = normalized ? normalized.split(' ').length : 0;
    const probs = normalized ? classifier.predictProba(normalized) : Object.fromEntries(LABELS.map((l) => [l, l === 'CLEAN' ? 1 : 0]));
    const pToxic = 1 - probs.CLEAN;
    const [modelCategory, modelP] = maxBy(Object.entries(probs).filter(([l]) => l !== 'CLEAN'), ([, p]) => p);

    const matches = findMatches(text, lexicon, pToxic, limits.block);
    let decision;
    let category;
    let severity;
    let signals = [];
    if (matches.length) {
      const strongest = maxBy(matches, (m) => SEVERITY_RANK[m.entry.severity] * 2 + (SERIOUS.has(m.entry.category) ? 1 : 0));
      ({ category, severity } = strongest.entry);
      if ((category === 'MILD_PROFANITY' || category === 'VULGAR') && isAddressed(tokenize(text))) {
        category = 'PERSONAL_ABUSE';
        severity = higherSeverity(severity, 'medium');
      }
      const serious = matches.find((m) => SERIOUS.has(m.entry.category));
      if (serious) {
        category = serious.entry.category;
        severity = higherSeverity(severity, serious.entry.severity);
      }
      if (SERIOUS.has(modelCategory) && modelP >= SERIOUS_ESCALATION && severity !== 'high') {
        category = modelCategory;
        severity = 'high';
      }
      decision = 'block';
      signals = ['word_list', ...(pToxic >= limits.block ? ['model'] : [])];
    } else if (words >= MIN_WORDS_FOR_MODEL && pToxic >= limits.block) {
      [decision, category, severity, signals] = ['block', modelCategory, CATEGORY_SEVERITY[modelCategory], ['model']];
    } else if (words >= MIN_WORDS_FOR_MODEL && pToxic >= limits.uncertain) {
      [decision, category, severity, signals] = ['uncertain', modelCategory, CATEGORY_SEVERITY[modelCategory], ['model']];
    } else {
      [decision, category, severity] = ['allow', 'CLEAN', 'none'];
    }

    const language = detectLanguage(text);
    const flagged = matches.map((m) => ({ text: m.text, start: m.start, end: m.end, category: m.entry.category }));

    let explanation;
    if (decision === 'allow') {
      explanation = 'No inappropriate language was detected.';
    } else if (decision === 'uncertain') {
      explanation = `The content could not be verified as appropriate. It may contain ${DISPLAY[category].toLowerCase()}. Please rephrase it.`;
    } else {
      const terms = [...new Set(flagged.map((f) => `"${f.text}"`))].join(', ');
      explanation = EXPLANATIONS[category] + (terms ? ` Flagged: ${terms}.` : ' No specific words could be highlighted.');
    }

    return {
      decision,
      blocked: decision !== 'allow',
      is_toxic: decision === 'block' ? true : decision === 'uncertain' ? null : false,
      category,
      category_label: DISPLAY[category],
      severity,
      confidence: round3(decision !== 'allow' ? pToxic : 1 - pToxic),
      detected_language: language.name,
      language_code: language.code,
      flagged_terms: flagged,
      explanation,
      signals,
      probabilities: probs,
      model: { name: classifier.name, version },
      latency_ms: Math.round((performance.now() - started) * 10) / 10,
    };
  };

  return { moderate, name: classifier.name, version, thresholds: limits, features: classifier.nFeatures };
};

// ---------- process-wide instance ----------

let instance = null;
let loadError = null;

/** Loads the model once (at startup or on first use). Returns the moderator, or null if it cannot be loaded. */
export const loadModerator = () => {
  if (instance || loadError) return instance;
  try {
    const started = performance.now();
    instance = createModerator();
    instance.moderate('warm up'); // first call compiles the regular expressions and JIT paths
    instance.loadMs = Math.round(performance.now() - started);
  } catch (error) {
    loadError = error;
    console.error(`[moderation] Model could not be loaded: ${error.message}`);
  }
  return instance;
};

export const moderatorStatus = () => {
  loadModerator();
  return instance
    ? { available: true, model: instance.name, version: instance.version, thresholds: instance.thresholds, load_ms: instance.loadMs }
    : { available: false, error: 'Moderation model failed to load' };
};
