import { Router } from 'express';
import { createPost, getPosts, getPost, updatePost, deletePost } from '../controllers/postController.js';
import { likePost, unlikePost, getPostLikes } from '../controllers/likeController.js';
import { addComment, getComments } from '../controllers/commentController.js';
import { protect, optionalAuth } from '../middleware/authMiddleware.js';
import { validate, allowOnlyFields } from '../middleware/validate.js';
import { paginationRules } from '../utils/pagination.js';
import { idParam, createPostRules, updatePostRules, listPostsRules, commentRules } from '../validators/index.js';

const router = Router();

// Posts: reading is public (personalized when a token is sent); writing requires a JWT
router
  .route('/')
  .get(optionalAuth, validate(listPostsRules), getPosts)
  .post(protect, allowOnlyFields('content', 'image_url'), validate(createPostRules), createPost);

router
  .route('/:id')
  .get(optionalAuth, validate(idParam()), getPost)
  .put(protect, allowOnlyFields('content', 'image_url'), validate(updatePostRules), updatePost)
  .delete(protect, validate(idParam()), deletePost);

// Likes
router
  .route('/:id/like')
  .post(protect, validate(idParam()), likePost)
  .delete(protect, validate(idParam()), unlikePost);
router.get('/:id/likes', optionalAuth, validate(idParam(), paginationRules), getPostLikes);

// Comments on a post
router
  .route('/:id/comments')
  .get(optionalAuth, validate(idParam(), paginationRules), getComments)
  .post(protect, allowOnlyFields('content'), validate(idParam(), commentRules), addComment);

export default router;
