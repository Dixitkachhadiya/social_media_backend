import AppError from '../utils/AppError.js';

/**
 * Cross-origin policy for browsers, shared by Express (app.js) and Socket.IO (socket/index.js).
 *
 * Allowed origins come ONLY from FRONTEND_URL (comma-separated), e.g.
 *   FRONTEND_URL=https://my-frontend.onrender.com,http://localhost:3000,http://localhost:5173
 * Without FRONTEND_URL, development/test allow the local dev servers; production allows none.
 *
 * - Unknown origins are rejected (403 for HTTP, refused handshake for Socket.IO).
 * - Requests without an Origin header (curl, Postman, server-to-server, Render health checks) are not
 *   browser cross-origin requests and are allowed; JWT authentication still applies.
 * - Credentials are off: the frontend sends the JWT in the Authorization header, not in cookies.
 */

const LOCAL_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];

// "https://App.example.com/" -> "https://app.example.com" (browsers send origins without a path or slash)
const normalizeOrigin = (origin) => String(origin).trim().replace(/\/+$/, '').toLowerCase();

export const allowedOrigins = () => {
  const configured = (process.env.FRONTEND_URL || '').split(',').map(normalizeOrigin).filter(Boolean);
  if (configured.length) return [...new Set(configured)];
  return process.env.NODE_ENV === 'production' ? [] : LOCAL_DEV_ORIGINS;
};

export const isOriginAllowed = (origin) => !origin || allowedOrigins().includes(normalizeOrigin(origin));

export const corsOptions = () => ({
  origin: (origin, callback) =>
    isOriginAllowed(origin) ? callback(null, true) : callback(new AppError('Origin not allowed by CORS policy', 403)),
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
  allowRequest: (req, callback) => callback(null, isOriginAllowed(req.headers.origin)),
});
