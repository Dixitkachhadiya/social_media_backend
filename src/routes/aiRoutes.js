import { Router } from 'express';
import {
  aiStatusHandler,
  generatePostHandler,
  improvePostHandler,
  summarizeHandler,
  moderateContentHandler,
} from '../controllers/aiController.js';
import { protect } from '../middleware/authMiddleware.js';
import { aiLimiter, moderationLimiter } from '../middleware/rateLimiters.js';
import { validate, allowOnlyFields } from '../middleware/validate.js';
import { generatePostRules, improvePostRules, summarizeRules, contentCheckRules } from '../validators/index.js';

const router = Router();

router.use(protect);

router.get('/status', aiStatusHandler);

// Generative endpoints (Ollama model): rate limited per user, model inference is expensive
router.post('/generate-post', aiLimiter, allowOnlyFields('topic', 'tone', 'description', 'keywords'), validate(generatePostRules), generatePostHandler);
router.post('/improve-post', aiLimiter, allowOnlyFields('content', 'tone'), validate(improvePostRules), improvePostHandler);
router.post('/summarize', aiLimiter, allowOnlyFields('postId', 'content', 'length'), validate(summarizeRules), summarizeHandler);

// Content check with suggestion (Ollama model); the same check runs again on every post/comment save
router.post('/moderate-content', moderationLimiter, allowOnlyFields('content', 'kind'), validate(contentCheckRules), moderateContentHandler);

export default router;
