import { matchedData } from 'express-validator';
import { Like, User, Profile } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { findAccessiblePost, formatAuthor } from '../services/postService.js';
import { notifySafely, createNotification } from '../services/notificationService.js';
import { broadcastPostActivity } from '../services/liveUpdateService.js';

const countLikes = (postId) => Like.count({ where: { post_id: postId } });

// POST /api/posts/:id/like
export const likePost = async (req, res) => {
  const { id } = matchedData(req);
  const post = await findAccessiblePost(id, req.user);

  // The unique (user_id, post_id) constraint rejects duplicates, even under concurrent requests (-> 409)
  await Like.create({ user_id: req.user.id, post_id: post.id });

  if (post.user_id !== req.user.id) {
    await notifySafely(() =>
      createNotification({
        userId: post.user_id,
        type: 'like',
        message: `${req.user.username} liked your post`,
        actor: req.user,
        postId: post.id,
        dedupe: true,
      }),
    );
  }

  const likesCount = await countLikes(post.id);
  await broadcastPostActivity({ postId: post.id, type: 'like', actorId: req.user.id, likesCount });
  res.status(201).json({ success: true, message: 'Post liked', liked: true, likes_count: likesCount });
};

// DELETE /api/posts/:id/like
export const unlikePost = async (req, res) => {
  const { id } = matchedData(req);
  const post = await findAccessiblePost(id, req.user);

  const removed = await Like.destroy({ where: { user_id: req.user.id, post_id: post.id } });
  if (!removed) {
    throw new AppError('You have not liked this post', 404);
  }

  const likesCount = await countLikes(post.id);
  await broadcastPostActivity({ postId: post.id, type: 'unlike', actorId: req.user.id, likesCount });
  res.status(200).json({ success: true, message: 'Post unliked', liked: false, likes_count: likesCount });
};

// GET /api/posts/:id/likes
export const getPostLikes = async (req, res) => {
  const { id, ...query } = matchedData(req);
  const post = await findAccessiblePost(id, req.user);
  const pagination = getPagination(query);

  const { rows, count } = await Like.findAndCountAll({
    where: { post_id: post.id },
    attributes: ['created_at'],
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'username'],
        where: { is_active: true },
        include: [{ model: Profile, as: 'profile', attributes: ['full_name', 'avatar_url'] }],
      },
    ],
    order: [['created_at', 'DESC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });

  res.status(200).json({
    success: true,
    likes: rows.map((like) => ({ user: formatAuthor(like.user), liked_at: like.created_at })),
    pagination: paginationMeta(pagination, count),
  });
};
