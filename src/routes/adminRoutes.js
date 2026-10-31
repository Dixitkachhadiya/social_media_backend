import { Router } from 'express';
import { adminTest } from '../controllers/adminController.js';
import { listUsers, getUser, updateUserStatus, deleteUser } from '../controllers/adminUserController.js';
import {
  getStats,
  getRecentActivity,
  getRecentUsers,
  getRecentPosts,
  postAnnouncement,
} from '../controllers/adminDashboardController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import { validate, allowOnlyFields } from '../middleware/validate.js';
import { paginationRules } from '../utils/pagination.js';
import {
  idParam,
  listUsersRules,
  updateStatusRules,
  announcementRules,
  recentActivityRules,
  recentUsersRules,
} from '../validators/index.js';

const router = Router();

// Every route in this file requires an authenticated admin
router.use(protect, authorize('admin'));

router.get('/test', adminTest);

// User management
router.get('/users', validate(listUsersRules), listUsers);
router.get('/users/:id', validate(idParam()), getUser);
// Only is_active is accepted: roles cannot be changed through the API
router.patch('/users/:id/status', allowOnlyFields('is_active'), validate(updateStatusRules), updateUserStatus);
router.delete('/users/:id', validate(idParam()), deleteUser);

// Dashboard
router.get('/dashboard/stats', getStats);
router.get('/dashboard/recent-activity', validate(recentActivityRules), getRecentActivity);
router.get('/dashboard/recent-users', validate(recentUsersRules), getRecentUsers);
router.get('/dashboard/recent-posts', validate(paginationRules), getRecentPosts);

// Announcements (notification to every active user)
router.post('/announcements', allowOnlyFields('message'), validate(announcementRules), postAnnouncement);

export default router;
