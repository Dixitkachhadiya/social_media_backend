// Runs before every test file, before any application module is imported.
import dotenv from 'dotenv';
import { getTestDatabaseUrl } from './testDatabase.js';

dotenv.config({ quiet: true });

// Point the app at the test database; development data is never touched
process.env.DATABASE_URL = getTestDatabaseUrl().url;
process.env.NODE_ENV = 'test';

// External services never receive real traffic in tests. SMTP points at a mocked transport
// (tests/mockMailer.js) that records messages instead of sending them; the real credentials from
// .env are cleared.
process.env.SMTP_HOST = 'smtp.mock.invalid';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.EMAIL_FROM = 'AI Social <no-reply@test.local>';

const { useMockTransport } = await import('./mockMailer.js');
useMockTransport();

// Moderation: every post/comment save runs the local model. Unit tests use a deterministic fake with the
// same result shape; tests/moderation.integration.test.js and tests/aiModel.test.js use the real model.
const { useFakeModeration } = await import('./mockModeration.js');
useFakeModeration();
