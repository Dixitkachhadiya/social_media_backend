import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import sequelize from './config/database.js';
import { corsOptions } from './config/cors.js';
import { apiLimiter } from './middleware/rateLimiters.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import postRoutes from './routes/postRoutes.js';
import commentRoutes from './routes/commentRoutes.js';
import feedRoutes from './routes/feedRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { moderationHealth } from './services/moderationClient.js';

const app = express();

// Security middleware
app.disable('x-powered-by');
app.use(helmet());
app.use(cors(corsOptions()));

// Body parsing with size limits
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use('/api', apiLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Database connectivity check
app.get('/api/db-status', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({
      success: true,
      database: sequelize.getDatabaseName(),
      status: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'disconnected',
      message: 'Database is unreachable',
    });
  }
});

// Local content moderation service status (posts and comments cannot be saved while it is down)
app.get('/api/moderation/status', async (req, res) => {
  const { available } = await moderationHealth();
  res.status(available ? 200 : 503).json({ success: available, status: available ? 'available' : 'unavailable' });
});

// Feature routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai', aiRoutes);

// 404 and centralized error handling (must be registered last)
app.use(notFound);
app.use(errorHandler);

export default app;
