import { Router } from 'express';
import { updateComment, deleteComment } from '../controllers/commentController.js';
import { protect } from '../middleware/authMiddleware.js';
import { validate, allowOnlyFields } from '../middleware/validate.js';
import { idParam, commentRules } from '../validators/index.js';

const router = Router();

router.use(protect);

router
  .route('/:id')
  .put(allowOnlyFields('content'), validate(idParam(), commentRules), updateComment)
  .delete(validate(idParam()), deleteComment);

export default router;
