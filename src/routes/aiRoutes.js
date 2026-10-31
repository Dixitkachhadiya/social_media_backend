import { Router } from 'express';
import { summarizeHandler, moderateContentHandler } from '../controllers/aiController.js';
import { protect } from '../middleware/authMiddleware.js';
import { aiLimiter, moderationLimiter } from '../middleware/rateLimiters.js';
import { validate, allowOnlyFields } from '../middleware/validate.js';
import { summarizeRules, contentCheckRules } from '../validators/index.js';

const router = Router();

router.use(protect);

// Summaries run on the LOCAL extractive summarizer (no external AI); rate limited per user
router.post('/summarize', aiLimiter, allowOnlyFields('postId', 'content', 'length'), validate(summarizeRules), summarizeHandler);

// Content check on the LOCAL moderation model (no external AI); the same check runs on every post/comment save
router.post('/moderate-content', moderationLimiter, allowOnlyFields('content'), validate(contentCheckRules), moderateContentHandler);

export default router;
