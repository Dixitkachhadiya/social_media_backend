import { Router } from 'express';
import {
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

// Generative endpoints: rate limited per user (AI calls cost quota)
router.post('/generate-post', aiLimiter, allowOnlyFields('topic', 'tone'), validate(generatePostRules), generatePostHandler);
router.post('/improve-post', aiLimiter, allowOnlyFields('content'), validate(improvePostRules), improvePostHandler);
router.post('/summarize', aiLimiter, allowOnlyFields('postId', 'content', 'length'), validate(summarizeRules), summarizeHandler);

// Content check on the LOCAL moderation model (no external AI); the same check runs on every post/comment save
router.post('/moderate-content', moderationLimiter, allowOnlyFields('content'), validate(contentCheckRules), moderateContentHandler);

export default router;
