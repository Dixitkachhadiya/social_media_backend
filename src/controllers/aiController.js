import { matchedData } from 'express-validator';
import { Comment, User } from '../models/index.js';
import AppError from '../utils/AppError.js';
import { findAccessiblePost } from '../services/postService.js';
import { checkContent, BLOCKED_MESSAGE, CLEAN_MESSAGE, UNCERTAIN_MESSAGE } from '../services/moderationService.js';
import { MIN_SENTENCES, MIN_WORDS, SUMMARIZER, summarizeDiscussion, summarizeText } from '../ai/summarization/summarizer.js';

// Summaries are suggestions only; publishing is a separate, explicit POST /api/posts
const NOT_PUBLISHED_NOTE = 'Summaries are not published. Review the summary, then create a post with POST /api/posts.';
// Comments considered for a discussion summary (most recent)
const MAX_DISCUSSION_COMMENTS = 100;

// ---------- Summarization (local extractive model, no external AI) ----------

// POST /api/ai/summarize  { content, length? }  -> summary of the given text
//                         { postId }            -> summary of a post's discussion (comments)
export const summarizeHandler = async (req, res) => {
  const { postId, content, length = 'medium' } = matchedData(req);
  const meta = { ai_generated: true, method: SUMMARIZER.method, model: SUMMARIZER.name };

  if (content !== undefined) {
    const result = summarizeText(content, length);
    if (result.tooShort) {
      throw new AppError(`This text is too short to summarize. Write at least ${MIN_SENTENCES} sentences (${MIN_WORDS}+ words).`, 422, {
        code: 'TEXT_TOO_SHORT',
      });
    }
    return res.status(200).json({
      success: true,
      data: {
        summary: result.summary,
        length,
        original_length: content.length,
        summary_length: result.summary.length,
        sentences_total: result.sentences_total,
        sentences_selected: result.sentences_selected,
      },
      meta: { ...meta, published: false, note: NOT_PUBLISHED_NOTE },
    });
  }

  // Same visibility rules as the rest of the API (404 for posts the user cannot access)
  const post = await findAccessiblePost(postId, req.user);

  const totalComments = await Comment.count({ where: { post_id: post.id } });

  if (totalComments === 0) {
    return res.status(200).json({
      success: true,
      data: { post_id: post.id, summary: 'This post has no comments yet, so there is no discussion to summarize.', comments_total: 0, comments_included: 0 },
      meta: { ai_generated: false },
    });
  }

  // Most recent comments (bounded), summarized in chronological order
  const recent = await Comment.findAll({
    where: { post_id: post.id },
    include: [{ model: User, as: 'author', attributes: ['username'], where: { is_active: true }, required: true }],
    order: [['created_at', 'DESC']],
    limit: MAX_DISCUSSION_COMMENTS,
  });
  const comments = recent.reverse().map((c) => ({ author: c.author.username, content: c.content }));
  const { summary, points } = summarizeDiscussion({ post: { author: post.author.username, content: post.content }, comments });

  res.status(200).json({
    success: true,
    data: { post_id: post.id, summary, points, comments_total: totalComments, comments_included: comments.length },
    meta,
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
