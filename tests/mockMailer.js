// Mocked SMTP transport for automated tests: nothing is ever sent over the network.
// It behaves like a successful SMTP server (verify() passes, recipients accepted) and records
// every message so tests can read the codes from the "inbox".
import { setEmailTransporter } from '../src/services/emailService.js';

export const outbox = [];

export const createMockTransport = () => ({
  verify: async () => true,
  sendMail: async (message) => {
    outbox.push({ ...message, created_at: new Date() });
    return { accepted: [message.to], rejected: [], messageId: `<mock-${outbox.length}@test.local>` };
  },
  close: () => {},
});

export const useMockTransport = () => setEmailTransporter(createMockTransport());
