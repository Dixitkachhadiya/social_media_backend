// Allowed browser origins: FRONTEND_URL (comma-separated for several).
// Requests without an Origin header (curl, Postman, server-to-server) are unaffected by CORS.
export const allowedOrigins = () =>
  (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

export const corsOptions = () => ({
  origin: allowedOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
