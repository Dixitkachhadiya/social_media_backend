// Database connection exhaustion (e.g. "too many connections" on a hosted plan) must be a retryable 503,
// not an anonymous 500 that makes the frontend log the user out on page refresh.
import { jest } from '@jest/globals';
import { errorHandler } from '../src/middleware/errorHandler.js';

const respond = (err) => {
  const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  errorHandler(err, {}, res, () => {});
  return res;
};

test.each([
  ['connection limit', Object.assign(new Error('x'), { name: 'SequelizeConnectionError', parent: { message: 'too many connections for role "u"' } })],
  ['pool acquire timeout', Object.assign(new Error('Operation timeout'), { name: 'SequelizeConnectionAcquireTimeoutError' })],
])('%s -> 503 DATABASE_BUSY with Retry-After', (_, err) => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = respond(err);
  spy.mockRestore();
  expect(res.code).toBe(503);
  expect(res.headers['Retry-After']).toBe('5');
  expect(res.body).toMatchObject({ success: false, code: 'DATABASE_BUSY' });
});
