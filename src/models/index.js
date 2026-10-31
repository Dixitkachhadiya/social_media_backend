import sequelize from '../config/database.js';
import User from './User.js';
import Profile from './Profile.js';
import Post from './Post.js';
import Like from './Like.js';
import Comment from './Comment.js';
import Notification from './Notification.js';
import { EmailVerification, PasswordReset } from './authTokens.js';

// All models are registered here and associations are declared in one place.
// The schema itself is managed by migrations in src/database/migrations.
// onDelete options mirror the foreign keys created by those migrations.

const cascade = { onDelete: 'CASCADE' };

// One-to-one: each user has at most one profile
User.hasOne(Profile, { foreignKey: 'user_id', as: 'profile', ...cascade });
Profile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Posts
User.hasMany(Post, { foreignKey: 'user_id', as: 'posts', ...cascade });
Post.belongsTo(User, { foreignKey: 'user_id', as: 'author' });

// Likes: join table between users and posts
User.hasMany(Like, { foreignKey: 'user_id', as: 'likes', ...cascade });
Post.hasMany(Like, { foreignKey: 'post_id', as: 'likes', ...cascade });
Like.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Like.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });

// Comments
User.hasMany(Comment, { foreignKey: 'user_id', as: 'comments', ...cascade });
Post.hasMany(Comment, { foreignKey: 'post_id', as: 'comments', ...cascade });
Comment.belongsTo(User, { foreignKey: 'user_id', as: 'author' });
Comment.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });

// Notifications: recipient (cascade), actor (kept as history, set null), post (cascade)
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications', ...cascade });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'recipient' });
Notification.belongsTo(User, { foreignKey: 'related_user_id', as: 'actor', onDelete: 'SET NULL' });
Notification.belongsTo(Post, { foreignKey: 'post_id', as: 'post', ...cascade });

// Single-use tokens
User.hasMany(EmailVerification, { foreignKey: 'user_id', as: 'emailVerifications', ...cascade });
EmailVerification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(PasswordReset, { foreignKey: 'user_id', as: 'passwordResets', ...cascade });
PasswordReset.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

export { sequelize, User, Profile, Post, Like, Comment, Notification, EmailVerification, PasswordReset };
