import { Router } from 'express';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { idParam, listNotificationsRules } from '../validators/index.js';

const router = Router();

router.use(protect);

router.get('/', validate(listNotificationsRules), getNotifications);
router.get('/unread-count', getUnreadCount);
// Declared before "/:id/..." routes so "read-all" is not parsed as an ID
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', validate(idParam()), markAsRead);
router.delete('/:id', validate(idParam()), deleteNotification);

export default router;
