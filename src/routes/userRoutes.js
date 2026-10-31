import { Router } from 'express';
import { getMyProfile, updateMyProfile, getPublicProfile } from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// "/profile" must be declared before "/:id" so it is not treated as an ID
router.route('/profile').get(protect, getMyProfile).put(protect, updateMyProfile);

router.get('/:id', getPublicProfile);

export default router;
