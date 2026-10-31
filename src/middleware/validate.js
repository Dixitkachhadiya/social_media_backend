import { validationResult } from 'express-validator';
import AppError from '../utils/AppError.js';

/**
 * Runs express-validator chains and responds with 400 and per-field errors
 * in the same format as model validation errors: [{ field, message }].
 * Handlers read sanitized input with matchedData(req).
 */
export const validate = (...chains) => [
  ...chains.flat(),
  (req, res, next) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      const error = new AppError('Validation failed', 400);
      error.errors = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }));
      throw error;
    }
    next();
  },
];

/**
 * Rejects body fields that are not explicitly allowed. This blocks attempts to
 * set ownership or privilege fields (user_id, role, ...) through the body.
 */
export const allowOnlyFields =
  (...allowed) =>
  (req, res, next) => {
    const body = req.body;
    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
      throw new AppError('Request body must be a JSON object', 400);
    }

    const unknown = Object.keys(body ?? {}).filter((key) => !allowed.includes(key));
    if (unknown.length) {
      throw new AppError(`Unknown fields: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`, 400);
    }
    next();
  };
