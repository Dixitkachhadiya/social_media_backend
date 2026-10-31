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

// AI (Ollama): no request reaches a real model unless OLLAMA_INTEGRATION=1 (tests/moderation.integration.test.js).
// Every post/comment save is moderated; unit tests use a deterministic fake that returns the model's JSON.
if (process.env.OLLAMA_INTEGRATION !== '1') {
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9'; // nothing listens here
  process.env.OLLAMA_MODEL = 'test-model';
  process.env.OLLAMA_API_KEY = '';
}
const { useFakeModeration } = await import('./mockModeration.js');
useFakeModeration();
