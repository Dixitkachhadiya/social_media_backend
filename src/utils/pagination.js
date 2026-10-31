import { query } from 'express-validator';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export const paginationRules = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be a positive integer').toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be between 1 and ${MAX_LIMIT}`)
    .toInt(),
];

export const getPagination = ({ page = 1, limit = DEFAULT_LIMIT } = {}) => ({
  page,
  limit,
  offset: (page - 1) * limit,
});

export const paginationMeta = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  total_pages: Math.ceil(total / limit),
});
