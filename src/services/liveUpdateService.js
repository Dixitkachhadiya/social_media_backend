import { Like, Comment } from '../models/index.js';
import { emitToAll } from '../socket/index.js';

/**
 * Live feed updates over Socket.IO: after a like, unlike, comment change or post change every connected
 * client receives
 *
 *   post:activity { post_id, type, actor_id, likes_count, comments_count, comment_id? }
 *
 * type: like | unlike | comment-added | comment-updated | comment-deleted | post-updated | post-deleted
 *
 * Only ids and counts are broadcast, never content: a page that shows the post refetches it (or its
 * comments) over HTTP, so the API's visibility rules still decide what each user can see.
 * Failures are logged and never fail the request that caused the update.
 */
export const broadcastPostActivity = async ({ postId, type, actorId, commentId, likesCount }) => {
  try {
    const deleted = type === 'post-deleted';
    const [likes, comments] = deleted
      ? [0, 0]
      : await Promise.all([likesCount ?? Like.count({ where: { post_id: postId } }), Comment.count({ where: { post_id: postId } })]);
    emitToAll('post:activity', {
      post_id: postId,
      type,
      actor_id: actorId,
      likes_count: likes,
      comments_count: comments,
      ...(commentId && { comment_id: commentId }),
    });
  } catch (error) {
    console.error(`[socket] post:activity ${type} not sent: ${error.message}`);
  }
};
