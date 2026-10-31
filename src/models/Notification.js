import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

export const NOTIFICATION_TYPES = ['login', 'like', 'comment', 'announcement'];

// Messages are plain, human-readable text; never store tokens or credentials here
const Notification = sequelize.define(
  'Notification',
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
    type: {
      type: DataTypes.ENUM(...NOTIFICATION_TYPES),
      allowNull: false,
    },
    message: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    related_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: 'notifications',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false,
  },
);

export default Notification;
