import { matchedData } from 'express-validator';
import { Notification, User } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { formatNotification } from '../services/notificationService.js';

// Every query is scoped to req.user.id, so users can only see or change their own notifications
const countUnread = (userId) => Notification.count({ where: { user_id: userId, is_read: false } });

// GET /api/notifications?page&limit&unread=true
export const getNotifications = async (req, res) => {
  const { unread, ...query } = matchedData(req);
  const pagination = getPagination(query);

  const where = { user_id: req.user.id, ...(unread ? { is_read: false } : {}) };
  const { rows, count } = await Notification.findAndCountAll({
    where,
    include: [{ model: User, as: 'actor', attributes: ['id', 'username'] }],
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  res.status(200).json({
    success: true,
    notifications: rows.map((n) => formatNotification(n)),
    unread_count: await countUnread(req.user.id),
    pagination: paginationMeta(pagination, count),
  });
};

// GET /api/notifications/unread-count
export const getUnreadCount = async (req, res) => {
  res.status(200).json({ success: true, unread_count: await countUnread(req.user.id) });
};

// PATCH /api/notifications/:id/read
export const markAsRead = async (req, res) => {
  const { id } = matchedData(req);

  const notification = await Notification.findOne({ where: { id, user_id: req.user.id } });
  if (!notification) {
    throw new AppError('Notification not found', 404);
  }
  if (!notification.is_read) {
    await notification.update({ is_read: true });
  }

  res.status(200).json({ success: true, message: 'Notification marked as read', unread_count: await countUnread(req.user.id) });
};

// PATCH /api/notifications/read-all
export const markAllAsRead = async (req, res) => {
  const [updated] = await Notification.update({ is_read: true }, { where: { user_id: req.user.id, is_read: false } });
  res.status(200).json({ success: true, message: 'All notifications marked as read', updated, unread_count: 0 });
};

// DELETE /api/notifications/:id
export const deleteNotification = async (req, res) => {
  const { id } = matchedData(req);

  const deleted = await Notification.destroy({ where: { id, user_id: req.user.id } });
  if (!deleted) {
    throw new AppError('Notification not found', 404);
  }

  res.status(200).json({ success: true, message: 'Notification deleted' });
};
