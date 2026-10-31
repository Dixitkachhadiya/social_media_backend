import { matchedData } from 'express-validator';
import { Comment, User, Profile } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { findAccessiblePost, formatAuthor } from '../services/postService.js';
import { notifySafely, createNotification } from '../services/notificationService.js';
import { enforceModeration } from '../services/moderationService.js';

const PREVIEW_LENGTH = 80;

const authorInclude = (viewer) => ({
  model: User,
  as: 'author',
  attributes: ['id', 'username'],
  required: true,
  ...(viewer?.role === 'admin' ? {} : { where: { is_active: true } }),
  include: [{ model: Profile, as: 'profile', attributes: ['full_name', 'avatar_url'] }],
});

const formatComment = (comment) => ({
  id: comment.id,
  post_id: comment.post_id,
  content: comment.content,
  author: formatAuthor(comment.author),
  created_at: comment.created_at,
  updated_at: comment.updated_at,
});

const loadComment = (id, viewer) => Comment.findByPk(id, { include: [authorInclude(viewer)] });

// POST /api/posts/:id/comments
export const addComment = async (req, res) => {
  const { id, content } = matchedData(req);
  const post = await findAccessiblePost(id, req.user);

  // Mandatory moderation (local model) before saving: 422 if not clean, 503 if unavailable
  await enforceModeration(content, 'comment');

  const comment = await Comment.create({ user_id: req.user.id, post_id: post.id, content });

  if (post.user_id !== req.user.id) {
    const preview = content.length > PREVIEW_LENGTH ? `${content.slice(0, PREVIEW_LENGTH)}...` : content;
    await notifySafely(() =>
      createNotification({
        userId: post.user_id,
        type: 'comment',
        message: `${req.user.username} commented on your post: "${preview}"`,
        actor: req.user,
        postId: post.id,
      }),
    );
  }

  res.status(201).json({
    success: true,
    message: 'Comment added',
    comment: formatComment(await loadComment(comment.id, req.user)),
  });
};

// GET /api/posts/:id/comments (oldest first, like a conversation)
export const getComments = async (req, res) => {
  const { id, ...query } = matchedData(req);
  const post = await findAccessiblePost(id, req.user);
  const pagination = getPagination(query);

  const { rows, count } = await Comment.findAndCountAll({
    where: { post_id: post.id },
    include: [authorInclude(req.user)],
    order: [['created_at', 'ASC'], ['id', 'ASC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  res.status(200).json({
    success: true,
    comments: rows.map(formatComment),
    pagination: paginationMeta(pagination, count),
  });
};

// PUT /api/comments/:id (author only)
export const updateComment = async (req, res) => {
  const { id, content } = matchedData(req);

  const comment = await Comment.findByPk(id);
  if (!comment) {
    throw new AppError('Comment not found', 404);
  }
  if (comment.user_id !== req.user.id) {
    throw new AppError('You can only edit your own comments', 403);
  }

  await enforceModeration(content, 'comment');
  await comment.update({ content });

  res.status(200).json({
    success: true,
    message: 'Comment updated',
    comment: formatComment(await loadComment(comment.id, req.user)),
  });
};

// DELETE /api/comments/:id (author, or an admin moderating)
export const deleteComment = async (req, res) => {
  const { id } = matchedData(req);

  const comment = await Comment.findByPk(id);
  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  const isAuthor = comment.user_id === req.user.id;
  if (!isAuthor && req.user.role !== 'admin') {
    throw new AppError('You can only delete your own comments', 403);
  }

  await comment.destroy();

  res.status(200).json({
    success: true,
    message: isAuthor ? 'Comment deleted' : 'Comment removed by moderator',
  });
};
