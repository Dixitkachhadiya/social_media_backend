import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

export const COMMENT_MAX_LENGTH = 1000;

const Comment = sequelize.define(
  'Comment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Comment cannot be empty' },
        len: { args: [1, COMMENT_MAX_LENGTH], msg: `Comment must be at most ${COMMENT_MAX_LENGTH} characters` },
      },
    },
  },
  {
    tableName: 'comments',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);

export default Comment;
