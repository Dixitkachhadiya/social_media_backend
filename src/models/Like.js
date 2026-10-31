import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

// A user can like a post once: enforced by the likes_user_id_post_id_unique constraint
const Like = sequelize.define(
  'Like',
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
  },
  {
    tableName: 'likes',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  },
);

export default Like;
