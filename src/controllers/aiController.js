import { matchedData } from 'express-validator';
import { Comment, User } from '../models/index.js';
import { findAccessiblePost } from '../services/postService.js';
import { generatePost, improvePost } from '../services/aiWritingService.js';
import { summarizeDiscussion, summarizeText, SUMMARY_LIMITS } from '../services/summarizationService.js';
import { checkContent, blockedMessage, CLEAN_MESSAGE } from '../services/moderationService.js';
import { ollamaConfig, ollamaHealth } from '../services/ollamaService.js';

// AI output is returned as a suggestion only; publishing is a separate, explicit POST /api/posts (moderated)
const NOT_PUBLISHED_NOTE = 'Generated content is not published. Review it, then create a post with POST /api/posts.';
const meta = () => ({ ai_generated: true, provider: 'ollama', model: ollamaConfig().model });

// Aborts the model call when the client goes away before the answer (closed tab, cancelled request)
const clientSignal = (req, res) => {
  const controller = new AbortController();
  res.on('close', () => !res.writableFinished && controller.abort());
  return controller.signal;
};

// GET /api/ai/status -> a real end-to-end check (configuration, reachability, authentication, model), cached
// for a minute. Status: connected | not_configured | authentication_failed | model_unavailable | rate_limited |
// service_unavailable. No URLs, keys or upstream error text are returned.
export const aiStatusHandler = async (req, res) => {
  const { detail: _detail, ...health } = await ollamaHealth(); // eslint-disable-line no-unused-vars
  res.status(health.available ? 200 : 503).json({ success: health.available, ...health, operational: health.available });
};

// POST /api/ai/generate-post  { topic, tone? }
export const generatePostHandler = async (req, res) => {
  const { topic, tone = 'professional', description, keywords = [] } = matchedData(req);
  const content = await generatePost({ topic, tone, description, keywords, signal: clientSignal(req, res) });

  res.status(200).json({
    success: true,
    data: { content, topic, tone, ...(description && { description }), ...(keywords.length && { keywords }) },
    meta: { ...meta(), published: false, note: NOT_PUBLISHED_NOTE },
  });
};

// POST /api/ai/improve-post  { content }
export const improvePostHandler = async (req, res) => {
  const { content, tone } = matchedData(req);
  const improved = await improvePost({ content, tone, signal: clientSignal(req, res) });

  res.status(200).json({
    success: true,
    data: { original: content, improved, ...(tone && { tone }) },
    meta: { ...meta(), published: false, note: NOT_PUBLISHED_NOTE },
  });
};

// POST /api/ai/summarize  { content, length? }  -> summary of the given text
//                         { postId }            -> summary of a post's discussion (comments)
export const summarizeHandler = async (req, res) => {
  const { postId, content, length = 'medium' } = matchedData(req);

  if (content !== undefined) {
    const summary = await summarizeText({ content, length, signal: clientSignal(req, res) });
    return res.status(200).json({
      success: true,
      data: { summary, length, original_length: content.length, summary_length: summary.length },
      meta: { ...meta(), published: false, note: NOT_PUBLISHED_NOTE },
    });
  }

  // Same visibility rules as the rest of the API (404 for posts the user cannot access)
  const post = await findAccessiblePost(postId, req.user);

  const totalComments = await Comment.count({ where: { post_id: post.id } });

  // No discussion: answer directly without running the model
  if (totalComments === 0) {
    return res.status(200).json({
      success: true,
      data: { post_id: post.id, summary: 'This post has no comments yet, so there is no discussion to summarize.', comments_total: 0, comments_included: 0 },
      meta: { ai_generated: false },
    });
  }

  // Most recent comments (bounded), presented to the model in chronological order
  const recent = await Comment.findAll({
    where: { post_id: post.id },
    include: [{ model: User, as: 'author', attributes: ['username'], where: { is_active: true }, required: true }],
    order: [['created_at', 'DESC']],
    limit: SUMMARY_LIMITS.maxComments,
  });
  const comments = recent.reverse().map((c) => ({ author: c.author.username, content: c.content }));

  const { commentsIncluded, summary } = await summarizeDiscussion({
    post: { author: post.author.username, content: post.content },
    comments,
    signal: clientSignal(req, res),
  });

  res.status(200).json({
    success: true,
    data: { post_id: post.id, summary, comments_total: totalComments, comments_included: commentsIncluded },
    meta: meta(),
  });
};

// POST /api/ai/moderate-content  { content }  -> the same check that runs when a post/comment is saved,
// including the suggested respectful version. Informational only: saving always checks again.
export const moderateContentHandler = async (req, res) => {
  const { content, kind = 'post' } = matchedData(req);
  const moderation = await checkContent(content);
  res.status(200).json({
    success: true,
    data: {
      ...moderation,
      reason: moderation.explanation,
      flaggedWords: moderation.flagged_words,
      suggestedText: moderation.suggested_text,
      message: moderation.blocked ? blockedMessage(kind) : CLEAN_MESSAGE,
    },
  });
};
