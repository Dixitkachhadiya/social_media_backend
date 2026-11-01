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

test('stack traces are only returned on a local development machine, never on Render or in production', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const saved = { env: process.env.NODE_ENV, render: process.env.RENDER };
  try {
    const boom = new Error('boom at /opt/render/project/src/file.js');
    process.env.NODE_ENV = 'development';
    delete process.env.RENDER;
    expect(respond(boom).body.stack).toBeDefined();
    process.env.RENDER = 'true'; // Render sets this on its servers
    const onRender = respond(boom).body;
    expect(onRender).toEqual({ success: false, message: 'Internal Server Error' });
    process.env.NODE_ENV = 'production';
    delete process.env.RENDER;
    expect(respond(boom).body).toEqual({ success: false, message: 'Internal Server Error' });
  } finally {
    process.env.NODE_ENV = saved.env;
    if (saved.render === undefined) delete process.env.RENDER;
    else process.env.RENDER = saved.render;
    spy.mockRestore();
  }
});
