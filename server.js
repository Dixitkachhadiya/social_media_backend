import './src/config/env.js';
import http from 'node:http';
import app from './src/app.js';
import { connectDatabase } from './src/config/database.js';
import { sequelize } from './src/models/index.js';
import { createMigrator } from './src/database/migrator.js';
import { initSocket, closeSocket } from './src/socket/index.js';
import { checkEmailTransport } from './src/services/emailService.js';
import { moderationHealth } from './src/services/moderationClient.js';
import { isAIConfigured } from './src/services/aiService.js';
import { describeCorsConfig } from './src/config/cors.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDatabase();

    // The schema is managed by migrations: refuse to start against an outdated database
    const pending = await createMigrator(sequelize, { logger: undefined }).pending();
    if (pending.length) {
      throw new Error(`Database has ${pending.length} pending migration(s). Run "npm run migrate" first.`);
    }

    // CORS diagnostics (origins are public values; no secrets are logged)
    const cors = describeCorsConfig();
    console.log(`[cors] NODE_ENV=${process.env.NODE_ENV}; allowed origins (${cors.source}): ${cors.origins.join(', ') || '(none)'}`);
    if (cors.invalid.length) console.warn(`[cors] Ignored invalid FRONTEND_URL entries: ${cors.invalid.join(' | ')}`);
    if (!cors.origins.length) console.warn('[cors] No browser origin is allowed. Set FRONTEND_URL to your frontend URL(s), comma-separated.');

    await checkEmailTransport();
    if ((await moderationHealth()).available) {
      console.log('[moderation] Local moderation service is available.');
    } else {
      console.warn('[moderation] Local moderation service is NOT reachable. Posts and comments will be refused (503) until it runs: npm run moderation');
    }
    if (!isAIConfigured()) {
      console.warn('[ai] GEMINI_API_KEY is not set. AI endpoints will respond with 503.');
    }

    // Express and Socket.IO share one HTTP server
    const server = http.createServer(app);
    initSocket(server);

    server.on('error', (error) => {
      console.error(`Server failed to start: ${error.message}`);
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });

    const shutdown = async (signal) => {
      console.log(`${signal} received. Shutting down gracefully...`);
      await closeSocket();
      server.close(async () => {
        await sequelize.close();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(error.message);
    console.error('Server not started.');
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

startServer();
