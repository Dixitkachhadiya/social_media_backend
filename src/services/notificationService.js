import { Op, QueryTypes } from 'sequelize';
import { sequelize, User, Notification } from '../models/index.js';
import { emitToUser, emitToAdmins, emitToAll } from '../socket/index.js';

// Repeated logins by the same user within this window produce one admin notification
const LOGIN_DEDUPE_MS = 5 * 60 * 1000;

export const formatNotification = (notification, actor = notification.actor) => ({
  id: notification.id,
  type: notification.type,
  message: notification.message,
  post_id: notification.post_id,
  related_user: actor ? { id: actor.id, username: actor.username } : null,
  is_read: notification.is_read,
  created_at: notification.created_at,
});

/**
 * Notifications are side effects: a failure must never break the action that
 * triggered it (login, like, comment). Errors are logged instead.
 */
export const notifySafely = async (task) => {
  try {
    await task();
  } catch (error) {
    console.error(`[notification] ${error.message}`);
  }
};

/**
 * Stores a notification and pushes it to the recipient's socket room.
 * With dedupe, nothing is created if an identical notification already exists
 * (e.g. like -> unlike -> like by the same user on the same post).
 */
export const createNotification = async ({ userId, type, message, actor = null, postId = null, dedupe = false }) => {
  const fields = { user_id: userId, type, related_user_id: actor?.id ?? null, post_id: postId };

  if (dedupe && (await Notification.findOne({ where: fields, attributes: ['id'] }))) {
    return null;
  }

  const notification = await Notification.create({ ...fields, message });
  emitToUser(userId, 'notification', formatNotification(notification, actor));
  return notification;
};

// Tells every other active admin that a user logged in
export const notifyAdminsOfLogin = async (user) => {
  const actor = { id: user.id, username: user.username };
  emitToAdmins('admin:user-login', { user: { ...actor, role: user.role }, logged_in_at: user.last_login_at });

  const admins = await User.findAll({
    where: { role: 'admin', is_active: true, id: { [Op.ne]: user.id } },
    attributes: ['id'],
  });
  if (!admins.length) return;

  const recent = await Notification.findAll({
    where: {
      type: 'login',
      related_user_id: user.id,
      user_id: admins.map((a) => a.id),
      created_at: { [Op.gte]: new Date(Date.now() - LOGIN_DEDUPE_MS) },
    },
    attributes: ['user_id'],
  });
  const alreadyNotified = new Set(recent.map((n) => n.user_id));
  const recipients = admins.filter((a) => !alreadyNotified.has(a.id));
  if (!recipients.length) return;

  const notifications = await Notification.bulkCreate(
    recipients.map((admin) => ({
      user_id: admin.id,
      type: 'login',
      message: `${user.username} logged in`,
      related_user_id: user.id,
    })),
  );
  notifications.forEach((n) => emitToUser(n.user_id, 'notification', formatNotification(n, actor)));
};

// One notification per active user, inserted in a single statement
export const createAnnouncement = async ({ message, admin }) => {
  const [, recipients] = await sequelize.query(
    `INSERT INTO notifications (id, user_id, type, message, related_user_id, is_read, created_at)
     SELECT gen_random_uuid(), id, 'announcement', :message, :adminId, false, NOW()
     FROM users WHERE is_active = true`,
    { replacements: { message, adminId: admin.id }, type: QueryTypes.INSERT },
  );

  emitToAll('announcement', {
    type: 'announcement',
    message,
    related_user: { id: admin.id, username: admin.username },
    created_at: new Date(),
  });
  return recipients;
};
