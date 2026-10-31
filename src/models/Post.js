import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

export const POST_MAX_LENGTH = 5000;

const Post = sequelize.define(
  'Post',
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
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Content cannot be empty' },
        len: { args: [1, POST_MAX_LENGTH], msg: `Content must be at most ${POST_MAX_LENGTH} characters` },
      },
    },
    image_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    tableName: 'posts',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);

export default Post;
