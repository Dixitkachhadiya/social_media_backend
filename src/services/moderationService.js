import AppError from '../utils/AppError.js';
import { MAX_CHARS, loadModerator, moderatorStatus } from '../ai/moderation/moderator.js';

/**
 * Content moderation with our own trained model, running inside this Node.js process (src/ai/moderation).
 * No external AI APIs and no separate Python service. Every post and comment is checked here before it is saved.
 *
 * Fail closed: if the model cannot be loaded or a check fails, the request is refused with 503.
 * Unmoderated content is never published. User text is never logged.
 */

export const UNAVAILABLE_MESSAGE = 'Content checking is temporarily unavailable. Please try again.';
export const BLOCKED_MESSAGE = 'Please remove inappropriate words from your content before publishing.';
export const UNCERTAIN_MESSAGE = "We couldn't verify that this content is appropriate. Please rephrase it and try again.";
export const CLEAN_MESSAGE = 'Your content looks good.';

const DECISIONS = new Set(['allow', 'block', 'uncertain']);
const CATEGORIES = new Set(['CLEAN', 'MILD_PROFANITY', 'VULGAR', 'PERSONAL_ABUSE', 'HARASSMENT', 'HATE_SPEECH', 'THREAT']);

// Test seam: replace the model with a function (text) => result of the same shape
let engine = null;
export const setModerationEngine = (fn) => {
  engine = fn;
};

const runModel = (text) => {
  const moderator = loadModerator();
  if (!moderator) throw new Error('model not loaded');
  if (text.length > MAX_CHARS) throw new Error(`text longer than ${MAX_CHARS} characters`);
  return moderator.moderate(text);
};

// Only fields meant for users leave the backend (no model name, version, probabilities or timings)
const sanitize = (raw) => {
  if (!raw || !DECISIONS.has(raw.decision) || !CATEGORIES.has(raw.category)) {
    throw new Error('unexpected moderation result shape');
  }
  return {
    decision: raw.decision,
    blocked: raw.decision !== 'allow',
    is_toxic: raw.is_toxic,
    category: raw.category,
    category_label: raw.category_label,
    severity: raw.severity,
    confidence: raw.confidence,
    detected_language: raw.detected_language,
    flagged_terms: (raw.flagged_terms || []).map(({ text, start, end, category }) => ({ text, start, end, category })),
    explanation: raw.explanation,
  };
};

/** Checks text with the local model. Throws 503 (fail closed) when the model cannot be used. */
export const checkContent = async (text) => {
  try {
    return sanitize(engine ? await engine(text) : runModel(text));
  } catch (error) {
    console.error(`[moderation] Check failed: ${error.message}`);
    throw new AppError(UNAVAILABLE_MESSAGE, 503, { code: 'MODERATION_UNAVAILABLE' });
  }
};

/**
 * Mandatory moderation before creating/updating a post or comment.
 * Any non-clean decision is refused with 422 CONTENT_MODERATION_FAILED; the client must edit the text.
 */
export const enforceModeration = async (content, kind) => {
  const moderation = await checkContent(content);
  if (moderation.blocked) {
    // Outcome only; the content itself is never logged
    console.info(`[moderation] ${kind} refused: ${moderation.decision} ${moderation.category}`);
    throw new AppError(moderation.decision === 'uncertain' ? UNCERTAIN_MESSAGE : BLOCKED_MESSAGE, 422, {
      code: 'CONTENT_MODERATION_FAILED',
      details: { blocked: true, moderation },
    });
  }
  return moderation;
};

/** Model health for /api/moderation/status and startup logs (loads the model on first call). */
export const moderationHealth = () => {
  if (engine) return { available: true, mode: 'test' };
  return moderatorStatus();
};
