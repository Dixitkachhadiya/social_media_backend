// CORS for the REST API and Socket.IO: allowed origins come from FRONTEND_URL (comma-separated).
import http from 'node:http';
import { io as connectClient } from 'socket.io-client';
import app from '../src/app.js';
import { initSocket, closeSocket } from '../src/socket/index.js';
import { jest } from '@jest/globals';
import { allowedOrigins, describeCorsConfig, isOriginAllowed } from '../src/config/cors.js';
import { api, auth, resetDatabase, closeDatabase, createUser } from './helpers.js';

const LIVE_FRONTEND = 'https://my-frontend.example.com';
const savedFrontendUrl = process.env.FRONTEND_URL;
const savedNodeEnv = process.env.NODE_ENV;

let server;
let url;
let user;

const preflight = (origin, path = '/api/auth/login', method = 'POST') =>
  api()
    .options(path)
    .set('Origin', origin)
    .set('Access-Control-Request-Method', method)
    .set('Access-Control-Request-Headers', 'content-type,authorization');

beforeAll(async () => {
  // Spaces, a trailing slash and upper case must be tolerated in the configuration
  process.env.FRONTEND_URL = ` ${LIVE_FRONTEND.toUpperCase()}/ , http://localhost:3000,http://localhost:5173 `;
  await resetDatabase();
  user = await createUser();
  server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  process.env.FRONTEND_URL = savedFrontendUrl;
  process.env.NODE_ENV = savedNodeEnv;
  await closeSocket();
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

describe('allowed origins configuration', () => {
  test('reads FRONTEND_URL as a normalized, comma-separated list', () => {
    expect(allowedOrigins()).toEqual([LIVE_FRONTEND, 'http://localhost:3000', 'http://localhost:5173']);
    expect(isOriginAllowed('https://MY-FRONTEND.example.com')).toBe(true);
    expect(isOriginAllowed('https://my-frontend.example.com.evil.com')).toBe(false);
    expect(isOriginAllowed('http://localhost:4000')).toBe(false);
    expect(isOriginAllowed(undefined)).toBe(true); // no Origin header: not a browser cross-origin request
  });

  test('without FRONTEND_URL: local dev servers in development, nothing in production', () => {
    const saved = process.env.FRONTEND_URL;
    try {
      process.env.FRONTEND_URL = '';
      process.env.NODE_ENV = 'development';
      expect(allowedOrigins()).toEqual(expect.arrayContaining(['http://localhost:3000', 'http://localhost:5173']));
      process.env.NODE_ENV = 'production';
      expect(allowedOrigins()).toEqual([]);
      expect(isOriginAllowed('http://localhost:3000')).toBe(false);
    } finally {
      process.env.FRONTEND_URL = saved;
      process.env.NODE_ENV = savedNodeEnv;
    }
  });
});

describe('FRONTEND_URL parsing (common misconfigurations)', () => {
  const withEnv = (value, fn) => {
    const saved = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = value;
    try {
      fn();
    } finally {
      process.env.FRONTEND_URL = saved;
    }
  };

  test('quotes, paths, trailing slashes, ports and case are reduced to the origin', () => {
    withEnv(`"https://App.Example.com/login", 'http://localhost:5173/',https://other.example.com:8443/`, () => {
      expect(allowedOrigins()).toEqual(['https://app.example.com', 'http://localhost:5173', 'https://other.example.com:8443']);
      expect(isOriginAllowed('https://app.example.com')).toBe(true);
      expect(isOriginAllowed('https://other.example.com')).toBe(false); // port is part of the origin
      expect(isOriginAllowed('http://app.example.com')).toBe(false); // so is the scheme
    });
  });

  test('invalid entries are ignored and reported', () => {
    withEnv('my-frontend.onrender.com, https://ok.example.com, ftp://files.example.com', () => {
      const config = describeCorsConfig();
      expect(config.origins).toEqual(['https://ok.example.com']);
      expect(config.invalid).toEqual(['my-frontend.onrender.com', 'ftp://files.example.com']);
      expect(config.source).toBe('FRONTEND_URL');
    });
  });

  test('a rejected origin is logged once, with the configured list and no secrets', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await preflight('https://unlisted-frontend.example.org');
      await preflight('https://unlisted-frontend.example.org');
      const lines = warn.mock.calls.flat().filter((l) => String(l).includes('unlisted-frontend'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Allowed origins: https://my-frontend.example.com, http://localhost:3000');
      expect(lines[0]).not.toContain(process.env.JWT_SECRET);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('preflight (OPTIONS)', () => {
  test.each([LIVE_FRONTEND, 'http://localhost:3000', 'http://localhost:5173'])('%s is allowed', async (origin) => {
    const res = await preflight(origin);
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type,Authorization');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  test('works for every method and nested route', async () => {
    for (const [path, method] of [['/api/posts/1', 'PUT'], ['/api/notifications/read-all', 'PATCH'], ['/api/comments/1', 'DELETE']]) {
      const res = await preflight('http://localhost:3000', path, method);
      expect(res.status).toBe(204);
    }
  });

  test('unknown origins are rejected with 403 and no CORS headers', async () => {
    for (const origin of ['https://evil.example', 'http://localhost:4000', 'null']) {
      const res = await preflight(origin);
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.body).toMatchObject({ code: 'CORS_ORIGIN_NOT_ALLOWED', message: `Origin ${origin} is not allowed by the CORS policy` });
    }
  });
});

describe('actual requests', () => {
  test('login and an authenticated call from the live frontend carry CORS headers', async () => {
    const login = await api().post('/api/auth/login').set('Origin', LIVE_FRONTEND).send({ email: user.user.email, password: user.password });
    expect(login.status).toBe(200);
    expect(login.headers['access-control-allow-origin']).toBe(LIVE_FRONTEND);

    const me = await api().get('/api/auth/me').set('Origin', LIVE_FRONTEND).set(auth(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.user.id);
    expect(me.headers['access-control-allow-origin']).toBe(LIVE_FRONTEND);
    expect(me.headers['access-control-expose-headers']).toContain('Retry-After');
  });

  test('error responses also carry CORS headers (so the frontend can read them)', async () => {
    const res = await api().get('/api/auth/me').set('Origin', 'http://localhost:3000');
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  test('requests from unknown origins are refused before reaching the route', async () => {
    const res = await api().post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: user.user.email, password: user.password });
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('token');
  });

  test('requests without an Origin (curl, health checks) still work', async () => {
    expect((await api().get('/api/health')).status).toBe(200);
  });
});

describe('Socket.IO', () => {
  const connect = (origin, transports = ['websocket']) =>
    new Promise((resolve) => {
      const client = connectClient(url, {
        auth: { token: user.token },
        transports,
        reconnection: false,
        extraHeaders: { Origin: origin },
      });
      client.on('connected', () => {
        client.disconnect();
        resolve('connected');
      });
      client.on('connect_error', (error) => {
        client.disconnect();
        resolve(`rejected: ${error.message}`);
      });
    });

  test.each([LIVE_FRONTEND, 'http://localhost:5173'])('allowed origin %s can connect (websocket and polling)', async (origin) => {
    expect(await connect(origin)).toBe('connected');
    expect(await connect(origin, ['polling'])).toBe('connected');
  });

  test('unknown origins cannot open a socket', async () => {
    expect(await connect('https://evil.example')).toMatch(/^rejected/);
    expect(await connect('https://evil.example', ['polling'])).toMatch(/^rejected/);
  });

  test('polling handshake returns CORS headers for an allowed origin', async () => {
    const res = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: LIVE_FRONTEND } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(LIVE_FRONTEND);
  });
});
