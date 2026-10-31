import { matchedData } from 'express-validator';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { listPosts } from '../services/postService.js';

// GET /api/feed?page&limit&sort=latest|popular
// Posts from all active users with author, counts and the viewer's like status.
export const getFeed = async (req, res) => {
  const { sort = 'latest', ...query } = matchedData(req);
  const pagination = getPagination(query);

  const { posts, total } = await listPosts({ viewer: req.user, sort, ...pagination });

  res.status(200).json({
    success: true,
    sort,
    posts,
    pagination: paginationMeta(pagination, total),
  });
};
