import { Router } from 'express';
import { getFeed } from '../controllers/feedController.js';
import { protect } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { feedRules } from '../validators/index.js';

const router = Router();

router.get('/', protect, validate(feedRules), getFeed);

export default router;
