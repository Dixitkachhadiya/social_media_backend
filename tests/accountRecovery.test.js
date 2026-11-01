import { jest } from '@jest/globals';
import { api, auth, resetDatabase, closeDatabase, createUser, lastEmail, lastEmailOtp, emailCount } from './helpers.js';
import { User, EmailVerification, PasswordReset } from '../src/models/index.js';
import { setEmailTransporter } from '../src/services/emailService.js';
import { useMockTransport } from './mockMailer.js';
import { hashOtp } from '../src/utils/otp.js';
import { MAX_OTP_ATTEMPTS } from '../src/services/authTokenService.js';

beforeAll(resetDatabase);
afterAll(closeDatabase);

// Lets a test bypass the 60 s resend cooldown by ageing the latest code
const ageCodes = (Model, userId) =>
  Model.update({ created_at: new Date(Date.now() - 61_000) }, { where: { user_id: userId } });

// A code different from the real one
const wrongCode = (otp) => String((Number(otp) + 1) % 1_000_000).padStart(6, '0');

const register = async () => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const res = await api()
    .post('/api/auth/register')
    .send({ username: `otp_${suffix}`, email: `otp_${suffix}@test.com`, password: 'Password123!' });
  return { token: res.body.token, user: res.body.user };
};

describe('email verification with a 6-digit code', () => {
  test('1. a registered user can have a code sent to the registered email (JWT, no body)', async () => {
    const { token, user } = await register();
    expect(user.is_email_verified).toBe(false);

    const res = await api().post('/api/auth/send-verification').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'A verification code has been sent to your email address.',
      email_delivered: true,
      expires_in_seconds: 300,
      resend_after_seconds: 60,
    });
    expect(res.body.email).toMatch(/^ot\*+@test\.com$/);

    const email = lastEmail(user.email);
    expect(email.subject).toBe('Verify Your AI-Powered Social Media Platform Account');
    const otp = lastEmailOtp(user.email);
    expect(otp).toMatch(/^\d{6}$/);
    expect(email.html).toContain(otp);
    expect(email.html).toContain(user.username);
    expect(email.html).toContain('5 minutes');
    expect(email.html).toContain('AI-Powered Social Media Platform');
    expect(email.html).toContain('Never share this code with anyone.');
    expect(email.text).toContain('Never share this code with anyone.');
    expect(email.html).toContain('If you did not request this code, you can safely ignore this email.');
    // Never exposed in the API response, never stored in plain text, no JWT in the email
    expect(JSON.stringify(res.body)).not.toContain(otp);
    expect(email.html).not.toContain(token);
    const record = await EmailVerification.findOne({ where: { user_id: user.id } });
    expect(record.token_hash).toBe(hashOtp({ recordId: record.id, purpose: 'email_verification', otp }));
    expect(record.token_hash).not.toContain(otp);
    // Valid for 5 minutes (created_at is stamped a few ms after the expiry is computed)
    expect(Math.abs(record.expires_at.getTime() - record.created_at.getTime() - 5 * 60 * 1000)).toBeLessThan(1000);
  });

  test('2 & 5. the correct code verifies the email once; the code cannot be reused', async () => {
    const { user, token } = await createUser();
    await api().post('/api/auth/send-verification').set(auth(token)).expect(200);
    const otp = lastEmailOtp(user.email);

    const verify = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp });
    expect(verify.status).toBe(200);
    expect(verify.body.message).toBe('Email verified successfully');
    await user.reload();
    expect(user.is_email_verified).toBe(true);

    const reuse = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp });
    expect(reuse.status).toBe(400);
    expect(reuse.body.message).toBe('Email is already verified');
    expect(await EmailVerification.count({ where: { user_id: user.id, used_at: null } })).toBe(0);
  });

  test('3. an incorrect code is rejected, counted, and the code is locked after the limit', async () => {
    const { user, token } = await createUser();
    await api().post('/api/auth/send-verification').set(auth(token));
    const otp = lastEmailOtp(user.email);

    const first = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp: wrongCode(otp) });
    expect(first.status).toBe(400);
    expect(first.body.message).toBe(`Incorrect verification code. ${MAX_OTP_ATTEMPTS - 1} attempts left.`);
    expect(first.body.errors[0].field).toBe('otp');

    for (let i = 1; i < MAX_OTP_ATTEMPTS; i += 1) {
      await api().post('/api/auth/verify-email').set(auth(token)).send({ otp: wrongCode(otp) });
    }
    // Even the right code no longer works once the attempts are used up
    const locked = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toMatch(/expired or is no longer valid/);
    await user.reload();
    expect(user.is_email_verified).toBe(false);
  });

  test('4. an expired code is rejected', async () => {
    const { user, token } = await createUser();
    await api().post('/api/auth/send-verification').set(auth(token));
    const otp = lastEmailOtp(user.email);
    await EmailVerification.update({ expires_at: new Date(Date.now() - 1000) }, { where: { user_id: user.id } });

    const res = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/);
  });

  test('6. requesting a new code invalidates the previous one (after the cooldown)', async () => {
    const { user, token } = await createUser();
    await api().post('/api/auth/send-verification').set(auth(token));
    const firstOtp = lastEmailOtp(user.email);

    const cooldown = await api().post('/api/auth/send-verification').set(auth(token));
    expect(cooldown.status).toBe(429);
    expect(Number(cooldown.headers['retry-after'])).toBeGreaterThan(0);

    await ageCodes(EmailVerification, user.id);
    await api().post('/api/auth/send-verification').set(auth(token)).expect(200);
    const secondOtp = lastEmailOtp(user.email);

    if (firstOtp !== secondOtp) {
      const old = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp: firstOtp });
      expect(old.status).toBe(400);
    }
    expect((await api().post('/api/auth/verify-email').set(auth(token)).send({ otp: secondOtp })).status).toBe(200);
  });

  test('12. a code can only verify the account of the logged-in user', async () => {
    const owner = await createUser();
    const other = await createUser();
    await api().post('/api/auth/send-verification').set(auth(owner.token));
    const ownersOtp = lastEmailOtp(owner.user.email);

    // Requires a JWT; the other user's JWT cannot use the owner's code, and ids/emails in the body are rejected
    expect((await api().post('/api/auth/verify-email').send({ otp: ownersOtp })).status).toBe(401);
    expect((await api().post('/api/auth/verify-email').set(auth(other.token)).send({ otp: ownersOtp })).status).toBe(400);
    const spoof = await api().post('/api/auth/verify-email').set(auth(other.token)).send({ otp: ownersOtp, email: owner.user.email });
    expect(spoof.status).toBe(400);
    expect(spoof.body.message).toMatch(/Unknown fields: email/);

    await owner.user.reload();
    await other.user.reload();
    expect(owner.user.is_email_verified).toBe(false);
    expect(other.user.is_email_verified).toBe(false);
    // The owner's code still works for the owner
    expect((await api().post('/api/auth/verify-email').set(auth(owner.token)).send({ otp: ownersOtp })).status).toBe(200);
  });

  test('validates the code format', async () => {
    const { token } = await createUser();
    for (const otp of ['12345', '1234567', 'abcdef', '']) {
      const res = await api().post('/api/auth/verify-email').set(auth(token)).send({ otp });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('otp');
    }
  });

  test('public resend returns the same response for unknown and unverified emails', async () => {
    const { user } = await createUser({ login: false });
    const unknown = await api().post('/api/auth/resend-verification').send({ email: 'nobody@example.com' });
    const known = await api().post('/api/auth/resend-verification').send({ email: user.email });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(lastEmailOtp(user.email)).toMatch(/^\d{6}$/);
  });
});

describe('password reset with a 6-digit code', () => {
  test('8. forgot-password emails a code to registered addresses only, with an identical response', async () => {
    const { user } = await createUser({ login: false });
    const known = await api().post('/api/auth/forgot-password').send({ email: user.email });
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });

    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body).toMatchObject({ expires_in_seconds: 300, resend_after_seconds: 60 });
    expect(emailCount('ghost@example.com')).toBe(0);

    const email = lastEmail(user.email);
    expect(email.subject).toBe('Reset Your AI-Powered Social Media Platform Password');
    expect(email.html).toContain('If you did not request a password reset, do not share this code.');
    expect(JSON.stringify(known.body)).not.toContain(lastEmailOtp(user.email));
  });

  test('9 & 11. a correct code allows the reset, which invalidates old sessions and all reset records', async () => {
    const { user, token: oldJwt, password: oldPassword } = await createUser();
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const otp = lastEmailOtp(user.email);

    const verified = await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp });
    expect(verified.status).toBe(200);
    expect(verified.body.reset_token).toMatch(/^[a-f0-9]{64}$/);

    // The code was exchanged: it cannot be used a second time
    expect((await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp })).status).toBe(400);

    const check = await api().post('/api/auth/verify-reset-token').send({ token: verified.body.reset_token });
    expect(check.body.valid).toBe(true);

    // Make sure password_changed_at falls in a later second than the old JWT's iat
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const reset = await api().post('/api/auth/reset-password').send({ token: verified.body.reset_token, password: 'NewPassword456!' });
    expect(reset.status).toBe(200);
    expect(reset.body.message).toMatch(/Password reset successfully/);

    const me = await api().get('/api/auth/me').set(auth(oldJwt));
    expect(me.status).toBe(401);
    expect(me.body.message).toMatch(/password was changed/i);

    expect((await api().post('/api/auth/login').send({ email: user.email, password: oldPassword })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: user.email, password: 'NewPassword456!' })).status).toBe(200);
    const updated = await User.scope('withPassword').findByPk(user.id);
    expect(updated.password).toMatch(/^\$2[aby]\$/);

    expect(await PasswordReset.count({ where: { user_id: user.id, used_at: null } })).toBe(0);
    expect((await api().post('/api/auth/reset-password').send({ token: verified.body.reset_token, password: 'Another789!' })).status).toBe(400);
  });

  test('10. an incorrect code cannot reset the password and gives no account hints', async () => {
    const { user, password } = await createUser({ login: false });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const otp = lastEmailOtp(user.email);

    const wrong = await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp: wrongCode(otp) });
    const unknown = await api().post('/api/auth/verify-reset-otp').send({ email: 'ghost@example.com', otp });
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).not.toHaveProperty('reset_token');

    // No way around the code: reset-password needs a session token issued after a correct code
    const forged = await api().post('/api/auth/reset-password').send({ token: 'a'.repeat(64), password: 'Hacked12345!' });
    expect(forged.status).toBe(400);
    expect((await api().post('/api/auth/login').send({ email: user.email, password })).status).toBe(200);
  });

  test('reset codes are locked after too many wrong attempts and expire', async () => {
    const { user } = await createUser({ login: false });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const otp = lastEmailOtp(user.email);
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i += 1) {
      await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp: wrongCode(otp) });
    }
    expect((await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp })).status).toBe(400);

    await ageCodes(PasswordReset, user.id);
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const fresh = lastEmailOtp(user.email);
    await PasswordReset.update({ expires_at: new Date(Date.now() - 1000) }, { where: { user_id: user.id, used_at: null } });
    expect((await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp: fresh })).status).toBe(400);
  });

  test('a newer reset code invalidates the older one and any reset session', async () => {
    const { user } = await createUser({ login: false });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const first = lastEmailOtp(user.email);
    const session = await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp: first });

    await ageCodes(PasswordReset, user.id);
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    expect(emailCount(user.email)).toBe(2);
    expect((await api().post('/api/auth/verify-reset-token').send({ token: session.body.reset_token })).status).toBe(400);
  });

  test('rejects weak passwords', async () => {
    const { user } = await createUser({ login: false });
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    const { body } = await api().post('/api/auth/verify-reset-otp').send({ email: user.email, otp: lastEmailOtp(user.email) });
    const weak = await api().post('/api/auth/reset-password').send({ token: body.reset_token, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.errors[0].field).toBe('password');
  });
});

describe('7. rate limiting', () => {
  const previousEnv = process.env.NODE_ENV;
  // Limiters are disabled in NODE_ENV=test; enable them for this block only
  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => {
    process.env.NODE_ENV = previousEnv;
    console.warn.mockRestore();
  });

  test('code checks are limited per account', async () => {
    const { token } = await createUser();
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await api().post('/api/auth/verify-email').set(auth(token)).send({ otp: '000000' })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  test('code emails are limited per address', async () => {
    const { user } = await createUser({ login: false });
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await api().post('/api/auth/forgot-password').send({ email: user.email })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    // The 60 s cooldown means only one email was actually sent
    expect(emailCount(user.email)).toBe(1);
  });
});

describe('10. multiple users', () => {
  test('each user receives their own code at their own registered address', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await api().post('/api/auth/send-verification').set(auth(alice.token)).expect(200);
    await api().post('/api/auth/send-verification').set(auth(bob.token)).expect(200);

    expect(lastEmail(alice.user.email).to).toBe(alice.user.email);
    expect(lastEmail(bob.user.email).to).toBe(bob.user.email);
    expect(lastEmail(alice.user.email).html).toContain(alice.user.username);
    expect(lastEmail(bob.user.email).html).toContain(bob.user.username);

    // Bob's code only verifies Bob (12): the correct database record is updated
    await api().post('/api/auth/verify-email').set(auth(bob.token)).send({ otp: lastEmailOtp(bob.user.email) }).expect(200);
    await alice.user.reload();
    await bob.user.reload();
    expect(bob.user.is_email_verified).toBe(true);
    expect(alice.user.is_email_verified).toBe(false);
  });
});

describe('8 & 9. SMTP failures never report a delivered email', () => {
  let errorSpy;
  let sent;

  beforeAll(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => useMockTransport());
  afterAll(() => {
    errorSpy.mockRestore();
    useMockTransport();
  });

  const authError = () =>
    Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
      code: 'EAUTH',
      responseCode: 535,
      command: 'AUTH PLAIN',
    });

  // Gmail rejects the login: verify() fails like the real server would
  const rejectingLogin = () => ({
    verify: async () => {
      throw authError();
    },
    sendMail: async () => {
      throw authError();
    },
  });

  // The connection check passes but this particular message fails
  const failingSend = () => ({
    verify: async () => true,
    sendMail: async () => {
      throw Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION' });
    },
  });

  // The server answers but refuses the recipient
  const rejectingRecipient = () => {
    sent = [];
    return { verify: async () => true, sendMail: async (m) => ({ accepted: [], rejected: [m.to] }) };
  };

  test('Gmail authentication failure: 502, no code is issued, nothing claims delivery', async () => {
    const { user, token } = await createUser();
    setEmailTransporter(rejectingLogin());
    const before = emailCount(user.email);

    const res = await api().post('/api/auth/send-verification').set(auth(token));
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/^Could not send email/);
    expect(res.body).not.toHaveProperty('email_delivered');
    expect(JSON.stringify(res.body)).not.toMatch(/535|Password not accepted/);
    expect(await EmailVerification.count({ where: { user_id: user.id } })).toBe(0);
    expect(emailCount(user.email)).toBe(before);

    // Logs explain the failure without the code or credentials
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/SMTP connection failed: EAUTH 535/);
  });

  test('a failure while sending discards the code and allows an immediate retry', async () => {
    const { user, token } = await createUser();
    setEmailTransporter(failingSend());
    expect((await api().post('/api/auth/send-verification').set(auth(token))).status).toBe(502);
    expect(await EmailVerification.count({ where: { user_id: user.id } })).toBe(0);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/Verification email delivery failed/);

    useMockTransport();
    const retry = await api().post('/api/auth/send-verification').set(auth(token));
    expect(retry.status).toBe(200);
    expect(lastEmailOtp(user.email)).toMatch(/^\d{6}$/);
  });

  test('a recipient rejected by the server is a failure, not a delivery', async () => {
    const { user, token } = await createUser();
    setEmailTransporter(rejectingRecipient());
    expect((await api().post('/api/auth/send-verification').set(auth(token))).status).toBe(502);
    expect(await EmailVerification.count({ where: { user_id: user.id } })).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test('forgot-password returns the same 502 for registered and unknown emails when SMTP is down', async () => {
    const { user } = await createUser({ login: false });
    setEmailTransporter(rejectingLogin());
    const known = await api().post('/api/auth/forgot-password').send({ email: user.email });
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost3@example.com' });
    expect(known.status).toBe(502);
    expect(known.body).toEqual(unknown.body);
    expect(await PasswordReset.count({ where: { user_id: user.id } })).toBe(0);
  });

  test('without SMTP configuration nothing is printed or faked: 503 for everyone', async () => {
    const savedHost = process.env.SMTP_HOST;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env.SMTP_HOST = '';
      const { user, token } = await createUser();
      const verify = await api().post('/api/auth/send-verification').set(auth(token));
      const forgotKnown = await api().post('/api/auth/forgot-password').send({ email: user.email });
      const forgotUnknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost4@example.com' });

      expect(verify.status).toBe(503);
      expect(forgotKnown.status).toBe(503);
      expect(forgotKnown.body).toEqual(forgotUnknown.body);
      expect(await EmailVerification.count({ where: { user_id: user.id } })).toBe(0);
      expect(await PasswordReset.count({ where: { user_id: user.id } })).toBe(0);
      // No code is ever written to the console
      const printed = [...warnSpy.mock.calls, ...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
      expect(printed).not.toMatch(/Your code: \d{6}/);
    } finally {
      process.env.SMTP_HOST = savedHost;
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test('a successful delivery goes from EMAIL_FROM to the account address only', async () => {
    useMockTransport();
    const { user, token } = await createUser();
    await api().post('/api/auth/send-verification').set(auth(token)).expect(200);
    expect(lastEmail(user.email)).toMatchObject({
      to: user.email,
      from: 'AI Social <no-reply@test.local>',
      subject: 'Verify Your AI-Powered Social Media Platform Account',
    });
  });
});
