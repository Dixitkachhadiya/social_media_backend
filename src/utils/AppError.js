/**
 * Operational error with an HTTP status code.
 * Thrown from controllers/middleware and formatted by the central error handler.
 * Messages are always shown to the client, so never put secrets in them.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, { retryAfter, code, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    // Seconds; sent as a Retry-After header (e.g. for 429 responses)
    this.retryAfter = retryAfter;
    // Optional machine-readable code (e.g. "CONTENT_FLAGGED") and extra response fields
    this.code = code;
    this.details = details;
  }
}

export default AppError;
