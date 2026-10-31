/**
 * The only module that talks to Ollama (https://docs.ollama.com/api). Every AI feature (moderation,
 * summarization, writing) goes through chat() below. Works with Ollama Cloud (https://ollama.com, Bearer API
 * key) and with a local or self-hosted Ollama server: both expose the same /api/chat and /api/tags.
 *
 * Plain fetch is used instead of the "ollama" npm SDK: the SDK wraps the same HTTP calls, and this client adds
 * what the app needs (timeouts, bounded retries, error classification, cancellation, a test seam).
 *
 * Configuration (backend environment only; never sent to the frontend, the key is never logged):
 *   OLLAMA_BASE_URL     https://ollama.com (Ollama Cloud) or http://localhost:11434 (local)
 *   OLLAMA_MODEL        e.g. gemma4:31b (as listed by GET /api/tags)
 *   OLLAMA_API_KEY      sent as "Authorization: Bearer <key>" (required for Ollama Cloud)
 *   OLLAMA_TIMEOUT_MS   per-request timeout (default 60000)
 *   OLLAMA_MAX_RETRIES  retries for transient failures: network errors, 5xx, short rate limits (default 2)
 *   OLLAMA_KEEP_ALIVE   local Ollama only: how long the model stays loaded (default 30m)
 *   OLLAMA_NUM_CTX      context window in tokens (default 8192)
 *   OLLAMA_MAX_CONCURRENCY  requests sent at the same time (default 4); up to 20 more wait their turn
 */
import AppError from '../utils/AppError.js';

const DEFAULT_TIMEOUT_MS = 60000;
const MODEL_CHECK_TTL_MS = 60000;
const HEALTH_TTL_MS = 60000;
const MAX_QUEUE = 20;
const MAX_RETRY_AFTER_S = 5; // longer rate-limit waits are not retried inside a user request

export const ollamaConfig = () => ({
  baseUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, ''),
  model: process.env.OLLAMA_MODEL || '',
  apiKey: process.env.OLLAMA_API_KEY || '',
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  maxRetries: Math.min(Number(process.env.OLLAMA_MAX_RETRIES ?? 2) || 0, 5),
  keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
  numCtx: Number(process.env.OLLAMA_NUM_CTX) || 8192,
  maxConcurrency: Number(process.env.OLLAMA_MAX_CONCURRENCY) || 4,
});

const isCloud = () => /(^|\.)ollama\.com$/i.test(new URL(ollamaConfig().baseUrl).hostname);

/**
 * code: NOT_CONFIGURED | UNREACHABLE | AUTH_FAILED | MODEL_NOT_FOUND | RATE_LIMITED | UPSTREAM_ERROR |
 *       TIMEOUT | BUSY | CANCELLED | BAD_RESPONSE | HTTP_<status>
 * Messages are for server logs (they never contain user text or the API key).
 */
export class OllamaError extends Error {
  constructor(code, message, { retryAfter, status } = {}) {
    super(message);
    this.name = 'OllamaError';
    this.code = code;
    this.retryAfter = retryAfter;
    this.status = status;
  }
}

const TRANSIENT = new Set(['UNREACHABLE', 'UPSTREAM_ERROR', 'RATE_LIMITED']);

/**
 * Converts a failure into a safe API error (details stay in the server log). `code` lets each feature use its
 * own error code (e.g. MODERATION_UNAVAILABLE); `rateLimitStatus` is 429 for writing tools and 503 for moderation.
 */
export const toAppError = (error, { feature, message, code = 'AI_UNAVAILABLE', rateLimitStatus = 429 }) => {
  if (error instanceof AppError) return error;
  console.error(`[ai] ${feature} failed (${error.code || error.name}): ${error.message}`);
  switch (error.code) {
    case 'TIMEOUT':
      return new AppError('The AI model took too long to respond. Please try again.', 504, { code, retryAfter: 10 });
    case 'RATE_LIMITED':
      return new AppError('The AI service is receiving too many requests. Please try again shortly.', rateLimitStatus, { code, retryAfter: error.retryAfter || 30 });
    case 'BUSY':
      return new AppError('The AI model is busy. Please try again in a moment.', 503, { code, retryAfter: 15 });
    case 'CANCELLED':
      return new AppError('The request was cancelled.', 499, { code });
    default:
      return new AppError(message, 503, { code, retryAfter: 30 });
  }
};

// Test seam: replace the HTTP layer with async (path, body) => response JSON (throw OllamaError to simulate failures)
let transport = null;
export const setOllamaTransport = (fn) => {
  transport = fn;
  modelCheck = { at: 0, ok: false };
  healthCache = null;
};

const parseRetryAfter = (value) => {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value || '');
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
};

const classifyHttp = async (response) => {
  const detail = (await response.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
  const { status } = response;
  if (status === 401 || status === 403) {
    return new OllamaError('AUTH_FAILED', `Ollama rejected the credentials (${status}). Check OLLAMA_API_KEY.`, { status });
  }
  if (status === 404 && /model/i.test(detail)) {
    return new OllamaError('MODEL_NOT_FOUND', `Model "${ollamaConfig().model}" is not available: ${detail}`, { status });
  }
  if (status === 429) {
    return new OllamaError('RATE_LIMITED', `Ollama rate limit reached: ${detail}`, { status, retryAfter: parseRetryAfter(response.headers.get('retry-after')) });
  }
  if (status >= 500) return new OllamaError('UPSTREAM_ERROR', `Ollama responded ${status}: ${detail}`, { status });
  return new OllamaError(`HTTP_${status}`, `Ollama responded ${status}: ${detail}`, { status });
};

const requestOnce = async (path, body, { timeoutMs, signal }) => {
  if (transport) return transport(path, body);
  const { baseUrl, apiKey } = ollamaConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw new OllamaError('CANCELLED', 'The client cancelled the request');
    if (timeout.aborted || error.name === 'TimeoutError') throw new OllamaError('TIMEOUT', `Ollama did not answer within ${timeoutMs} ms`);
    throw new OllamaError('UNREACHABLE', `Ollama is not reachable at ${baseUrl} (${error.cause?.code || error.message})`);
  }
  if (!response.ok) throw await classifyHttp(response);
  return response.json();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One API call with bounded retries for transient failures (never after a timeout or a cancellation). */
const request = async (path, { body, timeoutMs = ollamaConfig().timeoutMs, signal } = {}) => {
  const { maxRetries } = ollamaConfig();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(path, body, { timeoutMs, signal });
    } catch (error) {
      const retryable = TRANSIENT.has(error.code) && !(error.code === 'RATE_LIMITED' && error.retryAfter > MAX_RETRY_AFTER_S);
      if (!retryable || attempt >= maxRetries || signal?.aborted) throw error;
      const wait = error.code === 'RATE_LIMITED' && error.retryAfter ? error.retryAfter * 1000 : 500 * 2 ** attempt;
      console.warn(`[ai] ${error.code} on ${path}; retry ${attempt + 1}/${maxRetries} in ${wait} ms`);
      await sleep(wait);
    }
  }
};

// ---------- model availability ----------

// "gemma4:31b" and "gemma4:31b:latest" style names: "x" and "x:latest" are the same model
const sameModel = (a, b) => a === b || a === `${b}:latest` || b === `${a}:latest`;

let modelCheck = { at: 0, ok: false };

/** Lists the models the server offers (GET /api/tags). */
export const listModels = async () => {
  const body = await request('/api/tags', { timeoutMs: 10000 });
  return (body?.models || []).map((m) => m.name || m.model).filter(Boolean);
};

/** Throws OllamaError unless OLLAMA_MODEL is configured and listed by the server. Cached for a minute when it is. */
export const ensureModel = async () => {
  const { model, apiKey } = ollamaConfig();
  if (!model) throw new OllamaError('NOT_CONFIGURED', 'OLLAMA_MODEL is not set');
  if (isCloud() && !apiKey) throw new OllamaError('NOT_CONFIGURED', 'OLLAMA_API_KEY is required for Ollama Cloud');
  if (modelCheck.ok && modelCheck.model === model && Date.now() - modelCheck.at < MODEL_CHECK_TTL_MS) return;
  const models = await listModels();
  if (!models.some((name) => sameModel(name, model))) {
    modelCheck = { at: 0, ok: false };
    throw new OllamaError('MODEL_NOT_FOUND', `Model "${model}" is not offered by the Ollama server`);
  }
  modelCheck = { at: Date.now(), ok: true, model };
};

// ---------- health ----------

const STATUS = {
  NOT_CONFIGURED: 'not_configured',
  AUTH_FAILED: 'authentication_failed',
  MODEL_NOT_FOUND: 'model_unavailable',
  RATE_LIMITED: 'rate_limited',
};

let healthCache = null;

/**
 * Real end-to-end check for /api/ai/status, /api/moderation/status and startup: configuration, reachability,
 * model availability AND authentication (a one-token chat request: Ollama Cloud lists models without a key,
 * so only a chat proves the key works). Cached for a minute. Returns no URLs or keys.
 * { available, status: connected|not_configured|authentication_failed|model_unavailable|rate_limited|service_unavailable,
 *   configured, reachable, authenticated, model_available, model, provider, latency_ms, reason?, detail? }
 */
export const ollamaHealth = async ({ fresh = false } = {}) => {
  if (!fresh && healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.result;
  const { model, apiKey } = ollamaConfig();
  const result = {
    available: false,
    status: 'service_unavailable',
    provider: isCloud() ? 'ollama-cloud' : 'ollama',
    model: model || null,
    configured: Boolean(model) && (!isCloud() || Boolean(apiKey)),
    reachable: false,
    authenticated: false,
    model_available: false,
  };
  const started = Date.now();
  try {
    await ensureModel();
    result.reachable = true;
    result.model_available = true;
    const reply = await request('/api/chat', {
      body: { model, stream: false, messages: [{ role: 'user', content: 'Reply with OK' }], options: { num_predict: 1, temperature: 0 } },
      timeoutMs: 20000,
    });
    if (!reply?.message) throw new OllamaError('BAD_RESPONSE', 'Unexpected reply to the health check');
    Object.assign(result, { available: true, status: 'connected', authenticated: true, latency_ms: Date.now() - started });
  } catch (error) {
    if (!['NOT_CONFIGURED', 'UNREACHABLE', 'TIMEOUT'].includes(error.code)) result.reachable = true;
    if (error.code === 'MODEL_NOT_FOUND') result.model_available = false;
    Object.assign(result, { status: STATUS[error.code] || 'service_unavailable', reason: error.code || 'UNREACHABLE', detail: error.message });
  }
  healthCache = { at: Date.now(), result };
  return result;
};

// ---------- concurrency ----------

let active = 0;
const waiting = [];

const withSlot = async (fn) => {
  if (active >= ollamaConfig().maxConcurrency) {
    if (waiting.length >= MAX_QUEUE) throw new OllamaError('BUSY', 'Too many AI requests are waiting');
    await new Promise((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
};

// ---------- chat ----------

/**
 * Extracts the JSON object from a model reply. Ollama Cloud does not enforce the `format` schema, and models
 * sometimes wrap JSON in ``` fences or add a sentence around it. The result is parsed only; callers validate it.
 */
export const parseJsonReply = (content) => {
  const unfenced = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  for (const candidate of [unfenced, unfenced.slice(unfenced.indexOf('{'), unfenced.lastIndexOf('}') + 1)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  throw new OllamaError('BAD_RESPONSE', 'The model did not return a JSON object');
};

/**
 * Sends one chat request (stream disabled) and returns the reply text, or the parsed object when `json` is true.
 *
 *   messages     [{ role: 'system'|'user'|'assistant', content }]
 *   json         expect a JSON object (format: schema is sent too; local Ollama enforces it, the cloud may not)
 *   schema       JSON schema for `format` (optional)
 *   temperature  0 for decisions, higher for writing
 *   maxTokens    upper bound on generated tokens (num_predict)
 *   signal       optional AbortSignal (e.g. the client went away)
 */
export const chat = async ({ messages, json = false, schema, temperature = 0.2, maxTokens = 512, timeoutMs, signal }) => {
  await ensureModel();
  const { model, keepAlive, numCtx } = ollamaConfig();
  const body = await withSlot(() =>
    request('/api/chat', {
      body: {
        model,
        messages,
        stream: false,
        ...(!isCloud() && { keep_alive: keepAlive }),
        ...(json && { format: schema || 'json' }),
        options: { temperature, num_predict: maxTokens, num_ctx: numCtx },
      },
      timeoutMs,
      signal,
    }),
  );

  const content = body?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new OllamaError('BAD_RESPONSE', 'Ollama returned an empty reply');
  return json ? parseJsonReply(content) : content.trim();
};
