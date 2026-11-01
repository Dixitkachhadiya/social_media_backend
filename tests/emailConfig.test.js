// SMTP configuration: a Gmail SMTP_USER works without SMTP_HOST (smtp.gmail.com, port 587, STARTTLS);
// other providers still need SMTP_HOST.
import { isEmailConfigured } from '../src/services/emailService.js';

const KEYS = ['SMTP_HOST', 'SMTP_USER', 'EMAIL_FROM'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of KEYS) process.env[k] = saved[k];
});

test.each([
  ['Gmail address, no SMTP_HOST', { SMTP_HOST: '', SMTP_USER: 'someone@gmail.com', EMAIL_FROM: 'App <someone@gmail.com>' }, true],
  ['Googlemail address, no SMTP_HOST', { SMTP_HOST: '', SMTP_USER: 'someone@googlemail.com', EMAIL_FROM: 'App <someone@googlemail.com>' }, true],
  ['other provider without SMTP_HOST', { SMTP_HOST: '', SMTP_USER: 'someone@outlook.com', EMAIL_FROM: 'App <someone@outlook.com>' }, false],
  ['other provider with SMTP_HOST', { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'someone@example.com', EMAIL_FROM: 'App <someone@example.com>' }, true],
  ['no EMAIL_FROM', { SMTP_HOST: '', SMTP_USER: 'someone@gmail.com', EMAIL_FROM: '' }, false],
])('%s -> configured: %s', (_, env, expected) => {
  Object.assign(process.env, env);
  expect(isEmailConfigured()).toBe(expected);
});
