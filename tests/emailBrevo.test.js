// Email through Brevo's HTTPS API (BREVO_API_KEY), used where outbound SMTP is blocked (free Render services).
// Brevo's HTTP layer is faked; everything else (OTP issue, email content, verification) is real.
import { jest } from '@jest/globals';
import { api, auth, resetDatabase, closeDatabase, createUser } from './helpers.js';
import { setEmailTransporter } from '../src/services/emailService.js';
import { useMockTransport } from './mockMailer.js';

const realFetch = global.fetch;
const calls = [];
// Fake Brevo: GET /v3/account checks the key, POST /v3/smtp/email "sends"
const fakeBrevo = ({ accountStatus = 200, sendStatus = 201, unreachable = false } = {}) => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (!String(url).startsWith('https://api.brevo.com/')) return realFetch(url, options);
    if (unreachable) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers, body: options.body && JSON.parse(options.body) });
    const status = String(url).endsWith('/account') ? accountStatus : sendStatus;
    const body = status < 300 ? (String(url).endsWith('/account') ? { email: 'owner@example.com' } : { messageId: '<abc@relay.brevo>' }) : { code: 'unauthorized', message: 'Key not found' };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
};

const saved = {};
let errorSpy;
beforeAll(resetDatabase);
beforeEach(() => {
  for (const k of ['BREVO_API_KEY', 'EMAIL_FROM']) saved[k] = process.env[k];
  process.env.BREVO_API_KEY = 'test-brevo-key-123';
  process.env.EMAIL_FROM = 'Circlo <sender@example.com>';
  setEmailTransporter(null); // the real transport selection: Brevo because BREVO_API_KEY is set
  calls.length = 0;
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  errorSpy.mockRestore();
  useMockTransport();
});
afterAll(closeDatabase);

test('verification code is sent to the account address through the Brevo API, and that code verifies', async () => {
  fakeBrevo();
  const { user, token } = await createUser();
  const res = await api().post('/api/auth/send-verification').set(auth(token));
  expect(res.status).toBe(200);

  const send = calls.find((c) => c.url === 'https://api.brevo.com/v3/smtp/email');
  expect(send.method).toBe('POST');
  expect(send.headers['api-key']).toBe('test-brevo-key-123');
  expect(send.body).toMatchObject({
    sender: { name: 'Circlo', email: 'sender@example.com' },
    to: [{ email: user.email }],
    subject: 'Verify Your AI-Powered Social Media Platform Account',
  });
  const otp = send.body.textContent.match(/Your code: (\d{6})/)[1];
  expect(send.body.htmlContent).toContain(otp);
  expect(JSON.stringify(res.body)).not.toContain(otp);

  const verify = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp });
  expect(verify.status).toBe(200);
});

test('a rejected API key gives 502 "Could not send email" without exposing the key; no code is issued', async () => {
  fakeBrevo({ accountStatus: 401 });
  const { token } = await createUser();
  const res = await api().post('/api/auth/send-verification').set(auth(token));
  expect(res.status).toBe(502);
  expect(res.body.message).toMatch(/^Could not send email/);
  expect(JSON.stringify(res.body)).not.toContain('test-brevo-key-123');
  expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('test-brevo-key-123');
  expect(calls.some((c) => c.url.endsWith('/smtp/email'))).toBe(false);
});

test('Brevo unreachable: forgot-password answers 502 for everyone (no account enumeration)', async () => {
  fakeBrevo({ unreachable: true });
  const { user } = await createUser();
  const known = await api().post('/api/auth/forgot-password').send({ email: user.email });
  const unknown = await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
  expect([known.status, unknown.status]).toEqual([502, 502]);
  expect(known.body.message).toBe(unknown.body.message);
});
