import { Op, literal } from 'sequelize';
import { matchedData } from 'express-validator';
import { sequelize, User, Profile } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { disconnectUser } from '../socket/index.js';

const LIST_ATTRIBUTES = [
  'id', 'username', 'email', 'role', 'is_email_verified', 'is_active', 'last_login_at', 'created_at', 'updated_at',
];

const SORT = {
  newest: [['created_at', 'DESC']],
  oldest: [['created_at', 'ASC']],
  username: [['username', 'ASC']],
  last_login: [literal('"last_login_at" DESC NULLS LAST')],
};

// Escape LIKE wildcards so a search for "100%" matches literally
const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Locks all active admin rows so concurrent requests cannot remove the last admin
const countActiveAdminsLocked = async (transaction) =>
  (
    await User.findAll({
      where: { role: 'admin', is_active: true },
      attributes: ['id'],
      lock: transaction.LOCK.UPDATE,
      transaction,
    })
  ).length;

// GET /api/admin/users?page&limit&search&role&status&verified&sort
export const listUsers = async (req, res) => {
  const { search, role, status, verified, sort = 'newest', ...query } = matchedData(req);
  const pagination = getPagination(query);

  const where = {};
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    where[Op.or] = [{ username: { [Op.iLike]: pattern } }, { email: { [Op.iLike]: pattern } }];
  }
  if (role) where.role = role;
  if (status) where.is_active = status === 'active';
  if (verified !== undefined) where.is_email_verified = verified;

  const { rows, count } = await User.findAndCountAll({
    where,
    attributes: LIST_ATTRIBUTES,
    order: [...SORT[sort], ['id', 'ASC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  res.status(200).json({
    success: true,
    users: rows,
    filters: { search: search || null, role: role || null, status: status || null, verified: verified ?? null, sort },
    pagination: paginationMeta(pagination, count),
  });
};

// GET /api/admin/users/:id
export const getUser = async (req, res) => {
  const { id } = matchedData(req);

  const user = await User.findByPk(id, {
    attributes: [
      ...LIST_ATTRIBUTES,
      'password_changed_at',
      [literal('(SELECT COUNT(*) FROM posts p WHERE p.user_id = "User"."id")::int'), 'posts_count'],
      [literal('(SELECT COUNT(*) FROM comments c WHERE c.user_id = "User"."id")::int'), 'comments_count'],
      [literal('(SELECT COUNT(*) FROM likes l WHERE l.user_id = "User"."id")::int'), 'likes_given_count'],
    ],
    include: [{ model: Profile, as: 'profile', attributes: ['full_name', 'bio', 'avatar_url', 'location', 'website'] }],
  });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({ success: true, user });
};

// PATCH /api/admin/users/:id/status  { "is_active": boolean }
// Only the account status can change here; roles cannot be changed through the API.
export const updateUserStatus = async (req, res) => {
  const { id, is_active: isActive } = matchedData(req);

  if (id === req.user.id) {
    throw new AppError('You cannot change the status of your own account', 400);
  }

  const user = await sequelize.transaction(async (transaction) => {
    const target = await User.findByPk(id, { attributes: LIST_ATTRIBUTES, transaction, lock: transaction.LOCK.UPDATE });
    if (!target) {
      throw new AppError('User not found', 404);
    }

    if (!isActive && target.role === 'admin' && target.is_active && (await countActiveAdminsLocked(transaction)) <= 1) {
      throw new AppError('Cannot deactivate the last active admin', 409);
    }

    if (target.is_active !== isActive) {
      await target.update({ is_active: isActive }, { transaction });
    }
    return target;
  });

  // Deactivated users lose access immediately (HTTP requests are re-checked in protect)
  if (!isActive) disconnectUser(user.id);

  res.status(200).json({
    success: true,
    message: isActive ? 'User account activated' : 'User account deactivated',
    user,
  });
};

// DELETE /api/admin/users/:id
export const deleteUser = async (req, res) => {
  const { id } = matchedData(req);

  if (id === req.user.id) {
    throw new AppError('You cannot delete your own account', 400);
  }

  const deleted = await sequelize.transaction(async (transaction) => {
    const target = await User.findByPk(id, { attributes: ['id', 'username', 'role', 'is_active'], transaction, lock: transaction.LOCK.UPDATE });
    if (!target) {
      throw new AppError('User not found', 404);
    }

    if (target.role === 'admin' && target.is_active && (await countActiveAdminsLocked(transaction)) <= 1) {
      throw new AppError('Cannot delete the last active admin', 409);
    }

    // Profile, posts, likes, comments, tokens and notifications are removed by ON DELETE CASCADE
    await target.destroy({ transaction });
    return target;
  });

  disconnectUser(deleted.id);

  res.status(200).json({ success: true, message: `User ${deleted.username} deleted` });
};
