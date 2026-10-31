import { QueryTypes } from 'sequelize';
import { matchedData } from 'express-validator';
import { sequelize, User } from '../models/index.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { listPosts } from '../services/postService.js';
import { createAnnouncement } from '../services/notificationService.js';

const RECENT_LOGINS_LIMIT = 5;

// GET /api/admin/dashboard/stats
// All counters in a single round trip using PostgreSQL scalar subqueries.
export const getStats = async (req, res) => {
  const [counts] = await sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM users)::int                                                       AS total_users,
       (SELECT COUNT(*) FROM users WHERE is_active)::int                                      AS active_users,
       (SELECT COUNT(*) FROM users WHERE NOT is_active)::int                                  AS inactive_users,
       (SELECT COUNT(*) FROM users WHERE is_email_verified)::int                              AS verified_users,
       (SELECT COUNT(*) FROM users WHERE role = 'admin')::int                                 AS admins,
       (SELECT COUNT(*) FROM posts)::int                                                       AS total_posts,
       (SELECT COUNT(*) FROM comments)::int                                                    AS total_comments,
       (SELECT COUNT(*) FROM likes)::int                                                       AS total_likes,
       (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days')::int        AS new_users_last_7_days,
       (SELECT COUNT(*) FROM posts WHERE created_at >= NOW() - INTERVAL '7 days')::int        AS new_posts_last_7_days,
       (SELECT COUNT(*) FROM users WHERE last_login_at >= NOW() - INTERVAL '24 hours')::int   AS logins_last_24_hours`,
    { type: QueryTypes.SELECT },
  );

  const recentLogins = await User.findAll({
    where: sequelize.where(sequelize.col('last_login_at'), 'IS NOT', null),
    attributes: ['id', 'username', 'role', 'last_login_at'],
    order: [['last_login_at', 'DESC']],
    limit: RECENT_LOGINS_LIMIT,
  });

  res.status(200).json({
    success: true,
    stats: {
      users: {
        total: counts.total_users,
        active: counts.active_users,
        inactive: counts.inactive_users,
        verified: counts.verified_users,
        admins: counts.admins,
        new_last_7_days: counts.new_users_last_7_days,
        logins_last_24_hours: counts.logins_last_24_hours,
      },
      content: {
        posts: counts.total_posts,
        comments: counts.total_comments,
        likes: counts.total_likes,
        new_posts_last_7_days: counts.new_posts_last_7_days,
      },
      recent_logins: recentLogins,
    },
  });
};

// GET /api/admin/dashboard/recent-activity?page&limit&type
// Registrations, latest logins, posts, comments and likes merged into one timeline.
export const getRecentActivity = async (req, res) => {
  const { type, ...query } = matchedData(req);
  const pagination = getPagination(query);

  const rows = await sequelize.query(
    `SELECT a.*, COUNT(*) OVER()::int AS total
     FROM (
       SELECT 'registration' AS type, u.id AS user_id, u.username, NULL::uuid AS post_id, u.created_at AS occurred_at FROM users u
       UNION ALL
       SELECT 'login', u.id, u.username, NULL, u.last_login_at FROM users u WHERE u.last_login_at IS NOT NULL
       UNION ALL
       SELECT 'post', p.user_id, u.username, p.id, p.created_at FROM posts p JOIN users u ON u.id = p.user_id
       UNION ALL
       SELECT 'comment', c.user_id, u.username, c.post_id, c.created_at FROM comments c JOIN users u ON u.id = c.user_id
       UNION ALL
       SELECT 'like', l.user_id, u.username, l.post_id, l.created_at FROM likes l JOIN users u ON u.id = l.user_id
     ) a
     WHERE (:type::text IS NULL OR a.type = :type::text)
     ORDER BY a.occurred_at DESC
     LIMIT :limit OFFSET :offset`,
    {
      replacements: { type: type ?? null, limit: pagination.limit, offset: pagination.offset },
      type: QueryTypes.SELECT,
    },
  );

  const total = rows[0]?.total ?? 0;
  res.status(200).json({
    success: true,
    activities: rows.map(({ total: _total, ...activity }) => activity),
    pagination: paginationMeta(pagination, total),
  });
};

// GET /api/admin/dashboard/recent-users?page&limit&sort=registered|last_login
export const getRecentUsers = async (req, res) => {
  const { sort = 'registered', ...query } = matchedData(req);
  const pagination = getPagination(query);

  const { rows, count } = await User.findAndCountAll({
    attributes: ['id', 'username', 'email', 'role', 'is_active', 'is_email_verified', 'last_login_at', 'created_at'],
    ...(sort === 'last_login' ? { where: sequelize.where(sequelize.col('last_login_at'), 'IS NOT', null) } : {}),
    order: [[sort === 'last_login' ? 'last_login_at' : 'created_at', 'DESC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  res.status(200).json({ success: true, sort, users: rows, pagination: paginationMeta(pagination, count) });
};

// GET /api/admin/dashboard/recent-posts?page&limit (includes posts by deactivated users)
export const getRecentPosts = async (req, res) => {
  const pagination = getPagination(matchedData(req));
  const { posts, total } = await listPosts({ viewer: req.user, sort: 'latest', ...pagination });
  res.status(200).json({ success: true, posts, pagination: paginationMeta(pagination, total) });
};

// POST /api/admin/announcements  { "message": "..." }
export const postAnnouncement = async (req, res) => {
  const { message } = matchedData(req);
  const recipients = await createAnnouncement({ message, admin: req.user });
  res.status(201).json({ success: true, message: 'Announcement sent', recipients });
};
