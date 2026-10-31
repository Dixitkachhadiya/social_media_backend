import AppError from '../utils/AppError.js';

/**
 * Cross-origin policy for browsers, shared by Express (app.js) and Socket.IO (socket/index.js).
 *
 * Allowed origins come ONLY from FRONTEND_URL (comma-separated), e.g.
 *   FRONTEND_URL=https://my-frontend.onrender.com,http://localhost:3000,http://localhost:5173
 * Each entry is reduced to its origin (scheme://host[:port]), so a trailing slash, a path such as
 * "/login", surrounding quotes or upper case do not break matching. Unparseable entries are ignored
 * and reported at startup. Without FRONTEND_URL, development/test allow the local dev servers and
 * production allows none.
 *
 * - Unknown origins are rejected (403 for HTTP, refused handshake for Socket.IO) and logged once per
 *   origin, together with the configured list, so a mismatch is visible in the server logs.
 * - Requests without an Origin header (curl, Postman, server-to-server, health checks) are not
 *   browser cross-origin requests and are allowed; JWT authentication still applies.
 * - Credentials are off: the frontend sends the JWT in the Authorization header, not in cookies.
 */

const LOCAL_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];

// Reduces a configured or received value to a browser origin, or null if it isn't a valid http(s) URL
const toOrigin = (value) => {
  const cleaned = String(value).trim().replace(/^['"]|['"]$/g, '').trim();
  try {
    const url = new URL(cleaned);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin.toLowerCase() : null;
  } catch {
    return null;
  }
};

// Parsed configuration: { origins, invalid } (recomputed when FRONTEND_URL changes, e.g. in tests)
let cache = { raw: undefined, env: undefined, parsed: null };
const parseConfig = () => {
  const raw = process.env.FRONTEND_URL || '';
  const env = process.env.NODE_ENV;
  if (cache.parsed && cache.raw === raw && cache.env === env) return cache.parsed;

  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  const origins = [];
  const invalid = [];
  for (const entry of entries) {
    const origin = toOrigin(entry);
    if (origin) origins.push(origin);
    else invalid.push(entry);
  }
  const parsed = {
    origins: entries.length ? [...new Set(origins)] : env === 'production' ? [] : LOCAL_DEV_ORIGINS,
    invalid,
    fromEnv: entries.length > 0,
  };
  cache = { raw, env, parsed };
  return parsed;
};

export const allowedOrigins = () => parseConfig().origins;

export const isOriginAllowed = (origin) => {
  if (!origin) return true;
  const normalized = toOrigin(origin);
  return Boolean(normalized) && allowedOrigins().includes(normalized);
};

// Each rejected origin is logged once per process (origins are public values, not secrets)
const reportedOrigins = new Set();
const reportRejected = (origin, via) => {
  if (reportedOrigins.has(origin) || reportedOrigins.size > 100) return;
  reportedOrigins.add(origin);
  console.warn(`[cors] Rejected ${via} from origin "${origin}". Allowed origins: ${allowedOrigins().join(', ') || '(none)'}. ` +
    'If this is your frontend, add it to FRONTEND_URL exactly as shown (scheme, host and port).');
};

/** Startup summary (no secrets): which origins are allowed and which FRONTEND_URL entries were ignored. */
export const describeCorsConfig = () => {
  const { origins, invalid, fromEnv } = parseConfig();
  return { origins, invalid, source: fromEnv ? 'FRONTEND_URL' : 'built-in development defaults' };
};

export const corsOptions = () => ({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    reportRejected(origin, 'HTTP request');
    return callback(new AppError(`Origin ${origin} is not allowed by the CORS policy`, 403, { code: 'CORS_ORIGIN_NOT_ALLOWED' }));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // Lets the frontend read rate-limit information on cross-origin responses
  exposedHeaders: ['Retry-After', 'RateLimit', 'RateLimit-Policy'],
  // Browsers may cache a successful preflight for 10 minutes
  maxAge: 600,
  optionsSuccessStatus: 204,
});

// Socket.IO: same origins. `allowRequest` refuses the handshake (polling AND websocket) for unknown
// origins; `cors` only adds the headers that the HTTP long-polling transport needs.
export const socketCorsOptions = () => ({
  cors: {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    methods: ['GET', 'POST'],
    credentials: false,
  },
  allowRequest: (req, callback) => {
    const allowed = isOriginAllowed(req.headers.origin);
    if (!allowed) reportRejected(req.headers.origin, 'Socket.IO connection');
    callback(null, allowed);
  },
});
