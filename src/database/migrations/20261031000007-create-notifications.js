import { DataTypes } from 'sequelize';

export const up = async ({ context: queryInterface }) => {
  const { sequelize } = queryInterface;
  await queryInterface.createTable('notifications', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: sequelize.literal('gen_random_uuid()') },
    // Recipient
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    type: { type: DataTypes.ENUM('login', 'like', 'comment', 'announcement'), allowNull: false },
    message: { type: DataTypes.STRING(500), allowNull: false },
    // The user who triggered the notification; kept as history if that user is deleted
    related_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'posts', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  });
  // Inbox listing and unread counts
  await queryInterface.addIndex('notifications', ['user_id', 'created_at'], { name: 'notifications_user_id_created_at_idx' });
  await queryInterface.addIndex('notifications', ['user_id', 'is_read'], { name: 'notifications_user_id_is_read_idx' });
  // Duplicate checks (e.g. like -> unlike -> like)
  await queryInterface.addIndex('notifications', ['user_id', 'type', 'related_user_id', 'post_id'], {
    name: 'notifications_dedupe_idx',
  });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('notifications');
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_notifications_type"');
};
