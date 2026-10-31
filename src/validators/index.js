import { body, param, query } from 'express-validator';
import { paginationRules } from '../utils/pagination.js';
import { POST_MAX_LENGTH } from '../models/Post.js';
import { COMMENT_MAX_LENGTH } from '../models/Comment.js';

// ---------- shared ----------

export const idParam = (name = 'id') => param(name).isUUID().withMessage(`${name} must be a valid UUID`);

const httpUrl = (field, label) =>
  body(field)
    .optional({ values: 'null' })
    .isString()
    .withMessage(`${label} must be a string`)
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage(`${label} must be at most 500 characters`)
    .bail()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage(`${label} must be a valid http(s) URL`);

const text = (field, label, max, { optional = false } = {}) => {
  const chain = body(field);
  return (optional ? chain.optional() : chain.exists({ values: 'null' }).withMessage(`${label} is required`).bail())
    .isString()
    .withMessage(`${label} must be a string`)
    .bail()
    .trim()
    .isLength({ min: 1, max })
    .withMessage(`${label} must be between 1 and ${max} characters`);
};

const booleanQuery = (field) =>
  query(field).optional().isIn(['true', 'false']).withMessage(`${field} must be true or false`).toBoolean(true);

// ---------- auth: email verification & password reset ----------

export const emailRule = body('email')
  .exists({ values: 'falsy' })
  .withMessage('Email is required')
  .bail()
  .isString()
  .trim()
  .isEmail()
  .withMessage('Email must be a valid email address')
  .customSanitizer((value) => value.toLowerCase());

export const tokenRule = body('token')
  .exists({ values: 'falsy' })
  .withMessage('Token is required')
  .bail()
  .isString()
  .trim()
  .matches(/^[a-f0-9]{64}$/i)
  .withMessage('Token format is invalid');

// 6-digit one-time code from the verification / password reset email
export const otpRule = body('otp')
  .exists({ values: 'falsy' })
  .withMessage('Code is required')
  .bail()
  .isString()
  .withMessage('Code must be a string')
  .bail()
  .trim()
  .matches(/^\d{6}$/)
  .withMessage('Code must be 6 digits');

export const newPasswordRule = body('password')
  .exists({ values: 'falsy' })
  .withMessage('Password is required')
  .bail()
  .isString()
  .withMessage('Password must be a string')
  .bail()
  .isLength({ min: 8, max: 72 })
  .withMessage('Password must be between 8 and 72 characters');

// ---------- posts ----------

export const createPostRules = [text('content', 'Content', POST_MAX_LENGTH), httpUrl('image_url', 'Image URL')];

export const updatePostRules = [
  idParam(),
  text('content', 'Content', POST_MAX_LENGTH, { optional: true }),
  httpUrl('image_url', 'Image URL'),
  body().custom((value) => {
    if (!value || (!('content' in value) && !('image_url' in value))) {
      throw new Error('Provide content and/or image_url to update');
    }
    return true;
  }),
];

export const listPostsRules = [
  ...paginationRules,
  query('sort').optional().isIn(['latest', 'oldest', 'popular']).withMessage('sort must be latest, oldest or popular'),
  query('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
];

export const feedRules = [
  ...paginationRules,
  query('sort').optional().isIn(['latest', 'popular']).withMessage('sort must be latest or popular'),
];

// ---------- comments ----------

export const commentRules = [text('content', 'Comment', COMMENT_MAX_LENGTH)];

// ---------- notifications ----------

export const listNotificationsRules = [...paginationRules, booleanQuery('unread')];

// ---------- admin ----------

export const listUsersRules = [
  ...paginationRules,
  query('search').optional().isString().trim().isLength({ max: 100 }).withMessage('search must be at most 100 characters'),
  query('role').optional().isIn(['user', 'admin']).withMessage('role must be user or admin'),
  query('status').optional().isIn(['active', 'inactive']).withMessage('status must be active or inactive'),
  booleanQuery('verified'),
  query('sort')
    .optional()
    .isIn(['newest', 'oldest', 'username', 'last_login'])
    .withMessage('sort must be newest, oldest, username or last_login'),
];

export const updateStatusRules = [
  idParam(),
  body('is_active')
    .exists()
    .withMessage('is_active is required')
    .bail()
    .isBoolean({ strict: true })
    .withMessage('is_active must be true or false'),
];

export const announcementRules = [text('message', 'Message', 500)];

export const recentActivityRules = [
  ...paginationRules,
  query('type')
    .optional()
    .isIn(['registration', 'login', 'post', 'comment', 'like'])
    .withMessage('type must be registration, login, post, comment or like'),
];

export const recentUsersRules = [
  ...paginationRules,
  query('sort').optional().isIn(['registered', 'last_login']).withMessage('sort must be registered or last_login'),
];

// ---------- AI ----------

export const AI_TONES = ['professional', 'casual', 'friendly', 'humorous', 'inspirational', 'informative', 'motivational'];

const toneRule = () =>
  body('tone')
    .optional()
    .isString()
    .trim()
    .toLowerCase()
    .isIn(AI_TONES)
    .withMessage(`tone must be one of: ${AI_TONES.join(', ')}`);

export const generatePostRules = [
  text('topic', 'Topic', 200),
  text('description', 'Description', 500, { optional: true }),
  // Up to 10 keywords: an array of strings or one comma-separated string
  body('keywords')
    .optional()
    .customSanitizer((value) => (typeof value === 'string' ? value.split(',') : value))
    .custom((value) => {
      if (!Array.isArray(value) || value.length > 10 || value.some((k) => typeof k !== 'string' || k.trim().length > 40)) {
        throw new Error('keywords must be at most 10 words or short phrases (40 characters each)');
      }
      return true;
    })
    .customSanitizer((value) => value.map((k) => k.trim()).filter(Boolean)),
  toneRule(),
];

export const improvePostRules = [text('content', 'Content', 2000), toneRule()];

export const SUMMARY_LENGTH_VALUES = ['short', 'medium', 'detailed'];

// Either { postId } (summarize a post's discussion, unchanged) or { content, length? } (summarize text)
export const summarizeRules = [
  body().custom((value) => {
    const hasPost = value?.postId !== undefined;
    const hasContent = value?.content !== undefined;
    if (hasPost === hasContent) throw new Error('Provide either postId or content');
    if (hasPost && value.length !== undefined) throw new Error('length can only be used with content');
    return true;
  }),
  body('postId').optional().isUUID().withMessage('postId must be a valid UUID'),
  text('content', 'Content', POST_MAX_LENGTH, { optional: true }),
  body('length')
    .optional()
    .isIn(SUMMARY_LENGTH_VALUES)
    .withMessage(`length must be one of: ${SUMMARY_LENGTH_VALUES.join(', ')}`),
];

// Text checked by the content check (same limit as a post)
export const contentCheckRules = [text('content', 'Content', POST_MAX_LENGTH)];
