import AppError from '../utils/AppError.js';

/**
 * Client for the LOCAL moderation inference service (Backend/ai-moderation, FastAPI on 127.0.0.1).
 * No external AI APIs are involved. Every post and comment is checked here before it is saved.
 *
 * Fail closed: if the service is down, slow or returns something unexpected, the request is refused
 * with 503. Unmoderated content is never published. User text is never logged.
 */

const serviceUrl = () => (process.env.MODERATION_SERVICE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const timeoutMs = () => Number(process.env.MODERATION_TIMEOUT_MS) || 5000;

export const UNAVAILABLE_MESSAGE = 'Content checking is temporarily unavailable. Please try again.';
export const BLOCKED_MESSAGE = 'Please remove inappropriate words from your content before publishing.';
export const UNCERTAIN_MESSAGE = "We couldn't verify that this content is appropriate. Please rephrase it and try again.";
export const CLEAN_MESSAGE = 'Your content looks good.';

const DECISIONS = new Set(['allow', 'block', 'uncertain']);
const CATEGORIES = new Set(['CLEAN', 'MILD_PROFANITY', 'VULGAR', 'PERSONAL_ABUSE', 'HARASSMENT', 'HATE_SPEECH', 'THREAT']);

// Test seam: replace the HTTP call with a function (text) => service result
let transport = null;
export const setModerationTransport = (fn) => {
  transport = fn;
};

const callService = async (text) => {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.MODERATION_SERVICE_KEY) headers['X-Moderation-Key'] = process.env.MODERATION_SERVICE_KEY;
  const response = await fetch(`${serviceUrl()}/moderate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) {
    throw new Error(`moderation service responded ${response.status}`);
  }
  return response.json();
};

// Only fields meant for users leave the backend (no model name, version, probabilities or timings)
const sanitize = (raw) => {
  if (!raw || !DECISIONS.has(raw.decision) || !CATEGORIES.has(raw.category)) {
    throw new Error('unexpected moderation response shape');
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

/** Checks text with the local model. Throws 503 (fail closed) when the service cannot be used. */
export const checkContent = async (text) => {
  let raw;
  try {
    raw = transport ? await transport(text) : await callService(text);
    return sanitize(raw);
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? `timed out after ${timeoutMs()} ms` : error.cause?.code || error.message;
    console.error(`[moderation] Service unavailable at ${serviceUrl()}: ${reason}`);
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

/** Health of the local service, for /api/moderation/status and startup logs. */
export const moderationHealth = async () => {
  if (transport) return { available: true, mode: 'test' };
  try {
    const response = await fetch(`${serviceUrl()}/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { available: false };
    const body = await response.json();
    return { available: body.status === 'ok' };
  } catch {
    return { available: false };
  }
};
