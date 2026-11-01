import AppError from '../utils/AppError.js';

// Friendly messages for unique constraints, keyed by constraint/index name
const UNIQUE_MESSAGES = {
  users_email_key: 'Email is already registered',
  users_username_lower_unique: 'Username is already taken',
  likes_user_id_post_id_unique: 'You have already liked this post',
};

export const notFound = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

// Converts known library errors into AppErrors with proper status codes
const normalizeError = (err) => {
  if (err.name === 'SequelizeUniqueConstraintError') {
    const constraint = err.parent?.constraint;
    return new AppError(UNIQUE_MESSAGES[constraint] || 'Resource already exists', 409);
  }
  if (err.name === 'SequelizeValidationError') {
    const appError = new AppError('Validation failed', 400);
    appError.errors = err.errors.map((e) => ({ field: e.path, message: e.message }));
    return appError;
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return new AppError('Referenced resource does not exist', 409);
  }
  // Database refused or did not hand out a connection in time (e.g. connection limit reached): retryable
  if (['SequelizeConnectionError', 'SequelizeConnectionRefusedError', 'SequelizeConnectionTimedOutError', 'SequelizeConnectionAcquireTimeoutError'].includes(err.name)
    || /too many (connections|clients)/i.test(err.parent?.message || err.message || '')) {
    console.error(`[database] ${err.name}: ${err.parent?.message || err.message}`);
    return new AppError('The server is busy. Please try again in a moment.', 503, { retryAfter: 5, code: 'DATABASE_BUSY' });
  }
  if (err.type === 'entity.too.large') {
    return new AppError('Request body is too large', 413);
  }
  if (err.type === 'entity.parse.failed') {
    return new AppError('Malformed JSON in request body', 400);
  }
  return err;
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  const error = normalizeError(err);
  const statusCode = error.statusCode || error.status || 500;

  if (statusCode >= 500) {
    console.error(err);
  }

  if (error.retryAfter) {
    res.set('Retry-After', String(error.retryAfter));
  }

  res.status(statusCode).json({
    success: false,
    // AppError messages are written by us and safe to show; anything else 5xx is hidden
    message: statusCode >= 500 && !(error instanceof AppError) ? 'Internal Server Error' : error.message,
    ...(error.errors && { errors: error.errors }),
    ...(error instanceof AppError && error.code && { code: error.code }),
    ...(error instanceof AppError && error.details),
    // Stack traces only on a developer's machine: never on Render (it sets RENDER), even if NODE_ENV is wrong there
    ...(process.env.NODE_ENV === 'development' && !process.env.RENDER && statusCode >= 500 && { stack: err.stack }),
  });
};
