import { matchedData } from 'express-validator';
import { Comment, User } from '../models/index.js';
import { generatePost, improvePost, summarizeDiscussion, summarizeText, SUMMARY_LIMITS } from '../services/aiService.js';
import { findAccessiblePost } from '../services/postService.js';
import { checkContent, BLOCKED_MESSAGE, CLEAN_MESSAGE, UNCERTAIN_MESSAGE } from '../services/moderationClient.js';

// AI output is returned as a suggestion only; publishing is a separate, explicit POST /api/posts
const NOT_PUBLISHED_NOTE = 'Generated content is not published. Review it, then create a post with POST /api/posts.';

// POST /api/ai/generate-post  { topic, tone? }
export const generatePostHandler = async (req, res) => {
  const { topic, tone = 'professional' } = matchedData(req);
  const { text, provider, model } = await generatePost({ topic, tone });

  res.status(200).json({
    success: true,
    data: { content: text, topic, tone },
    meta: { provider, model, published: false, note: NOT_PUBLISHED_NOTE },
  });
};

// POST /api/ai/improve-post  { content }
export const improvePostHandler = async (req, res) => {
  const { content } = matchedData(req);
  const { text, provider, model } = await improvePost({ content });

  res.status(200).json({
    success: true,
    data: { original: content, improved: text },
    meta: { provider, model, published: false, note: NOT_PUBLISHED_NOTE },
  });
};

// POST /api/ai/summarize  { content, length? }  -> summary of the given text
//                         { postId }            -> summary of a post's discussion (comments)
export const summarizeHandler = async (req, res) => {
  const { postId, content, length = 'medium' } = matchedData(req);

  if (content !== undefined) {
    const { text, provider, model } = await summarizeText({ content, length });
    return res.status(200).json({
      success: true,
      data: { summary: text, length, original_length: content.length, summary_length: text.length },
      meta: { ai_generated: true, provider, model, published: false, note: NOT_PUBLISHED_NOTE },
    });
  }

  // Same visibility rules as the rest of the API (404 for posts the user cannot access)
  const post = await findAccessiblePost(postId, req.user);

  const totalComments = await Comment.count({ where: { post_id: post.id } });

  // No discussion: answer directly without spending AI quota
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

  const { commentsIncluded, result } = summarizeDiscussion({
    post: { author: post.author.username, content: post.content },
    comments,
  });
  const { text, provider, model } = await result;

  res.status(200).json({
    success: true,
    data: { post_id: post.id, summary: text, comments_total: totalComments, comments_included: commentsIncluded },
    meta: { ai_generated: true, provider, model },
  });
};

// ---------- Content check (local moderation model, no external AI) ----------

// POST /api/ai/moderate-content  { content }  -> same check that runs when a post/comment is saved
export const moderateContentHandler = async (req, res) => {
  const { content } = matchedData(req);
  const moderation = await checkContent(content);
  const message = { allow: CLEAN_MESSAGE, block: BLOCKED_MESSAGE, uncertain: UNCERTAIN_MESSAGE }[moderation.decision];
  res.status(200).json({ success: true, data: { ...moderation, message } });
};
