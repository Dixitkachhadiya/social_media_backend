import { matchedData } from 'express-validator';
import { Post } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { listPosts, getPostDetails } from '../services/postService.js';
import { enforceModeration } from '../services/moderationService.js';

// POST /api/posts
export const createPost = async (req, res) => {
  const { content, image_url = null } = matchedData(req);

  // Mandatory server-side moderation (local model) before saving: 422 if not clean, 503 if unavailable
  await enforceModeration(content, 'post');

  // Ownership always comes from the JWT
  const post = await Post.create({ user_id: req.user.id, content, image_url });

  res.status(201).json({
    success: true,
    message: 'Post created successfully',
    post: await getPostDetails(post.id, req.user),
  });
};

// GET /api/posts?page&limit&sort&user_id
export const getPosts = async (req, res) => {
  const { sort, user_id: authorId, ...query } = matchedData(req);
  const pagination = getPagination(query);

  const { posts, total } = await listPosts({ viewer: req.user, sort, authorId, ...pagination });

  res.status(200).json({ success: true, posts, pagination: paginationMeta(pagination, total) });
};

// GET /api/posts/:id
export const getPost = async (req, res) => {
  const { id } = matchedData(req);
  res.status(200).json({ success: true, post: await getPostDetails(id, req.user) });
};

// PUT /api/posts/:id (owner only)
export const updatePost = async (req, res) => {
  const { id, content, image_url } = matchedData(req, { includeOptionals: true });

  const post = await Post.findByPk(id);
  if (!post) {
    throw new AppError('Post not found', 404);
  }
  if (post.user_id !== req.user.id) {
    throw new AppError('You can only edit your own posts', 403);
  }

  // Same mandatory moderation as creation, applied to the new content (after the ownership check)
  if (content !== undefined) await enforceModeration(content, 'post');

  const updates = {};
  if (content !== undefined) updates.content = content;
  // An explicit null removes the image
  if ('image_url' in req.body) updates.image_url = image_url ?? null;
  await post.update(updates);

  res.status(200).json({
    success: true,
    message: 'Post updated successfully',
    post: await getPostDetails(post.id, req.user),
  });
};

// DELETE /api/posts/:id (owner, or an admin moderating)
export const deletePost = async (req, res) => {
  const { id } = matchedData(req);

  const post = await Post.findByPk(id);
  if (!post) {
    throw new AppError('Post not found', 404);
  }

  const isOwner = post.user_id === req.user.id;
  if (!isOwner && req.user.role !== 'admin') {
    throw new AppError('You can only delete your own posts', 403);
  }

  // Likes, comments and related notifications are removed by ON DELETE CASCADE
  await post.destroy();

  res.status(200).json({
    success: true,
    message: isOwner ? 'Post deleted successfully' : 'Post removed by moderator',
  });
};
