import { literal } from 'sequelize';
import { sequelize, User, Profile, Post } from '../models/index.js';
import AppError from '../utils/AppError.js';

/**
 * Builds the post query so a whole page of posts is fetched in ONE SQL statement:
 * author + profile via JOINs, and counts / "liked by me" via correlated subqueries
 * that use the likes(post_id), likes(user_id, post_id) and comments(post_id) indexes.
 */
const postAttributes = (viewerId) => [
  'id',
  'user_id',
  'content',
  'image_url',
  'created_at',
  'updated_at',
  [literal('(SELECT COUNT(*) FROM likes AS l WHERE l.post_id = "Post"."id")::int'), 'likes_count'],
  [literal('(SELECT COUNT(*) FROM comments AS c WHERE c.post_id = "Post"."id")::int'), 'comments_count'],
  [
    viewerId
      ? literal(
          `EXISTS (SELECT 1 FROM likes AS l WHERE l.post_id = "Post"."id" AND l.user_id = ${sequelize.escape(viewerId)})`,
        )
      : literal('false'),
    'liked_by_me',
  ],
];

// Posts of deactivated authors are hidden, except for admins
const authorInclude = (includeInactiveAuthors) => ({
  model: User,
  as: 'author',
  attributes: ['id', 'username'],
  required: true,
  ...(includeInactiveAuthors ? {} : { where: { is_active: true } }),
  include: [{ model: Profile, as: 'profile', attributes: ['full_name', 'avatar_url'] }],
});

const ORDER = {
  latest: [['created_at', 'DESC'], ['id', 'DESC']],
  oldest: [['created_at', 'ASC'], ['id', 'ASC']],
  popular: [[literal('"likes_count"'), 'DESC'], ['created_at', 'DESC'], ['id', 'DESC']],
};

export const formatAuthor = (user) => ({
  id: user.id,
  username: user.username,
  full_name: user.profile?.full_name ?? null,
  avatar_url: user.profile?.avatar_url ?? null,
});

export const formatPost = (post) => {
  const p = post.get({ plain: true });
  return {
    id: p.id,
    content: p.content,
    image_url: p.image_url,
    author: formatAuthor(p.author),
    likes_count: Number(p.likes_count),
    comments_count: Number(p.comments_count),
    liked_by_me: Boolean(p.liked_by_me),
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
};

export const listPosts = async ({ viewer, limit, offset, sort = 'latest', authorId }) => {
  const { rows, count } = await Post.findAndCountAll({
    where: authorId ? { user_id: authorId } : {},
    attributes: postAttributes(viewer?.id),
    include: [authorInclude(viewer?.role === 'admin')],
    order: ORDER[sort],
    limit,
    offset,
  });
  return { posts: rows.map(formatPost), total: count };
};

export const getPostDetails = async (postId, viewer) => {
  const post = await Post.findOne({
    where: { id: postId },
    attributes: postAttributes(viewer?.id),
    include: [authorInclude(viewer?.role === 'admin')],
  });
  if (!post) {
    throw new AppError('Post not found', 404);
  }
  return formatPost(post);
};

/**
 * Loads a post the viewer is allowed to interact with (like, comment, summarize).
 * Posts by deactivated authors behave as if they don't exist for non-admins.
 */
export const findAccessiblePost = async (postId, viewer, options = {}) => {
  const post = await Post.findOne({
    where: { id: postId },
    include: [{ ...authorInclude(viewer?.role === 'admin'), include: [] }],
    ...options,
  });
  if (!post) {
    throw new AppError('Post not found', 404);
  }
  return post;
};
