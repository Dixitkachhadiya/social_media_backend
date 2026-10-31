import { DataTypes } from 'sequelize';

export const up = async ({ context: queryInterface }) => {
  const { sequelize } = queryInterface;
  await queryInterface.createTable('likes', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: sequelize.literal('gen_random_uuid()') },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'posts', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  });
  // One like per user per post; also serves "did this user like this post" lookups
  await queryInterface.addConstraint('likes', {
    type: 'unique',
    fields: ['user_id', 'post_id'],
    name: 'likes_user_id_post_id_unique',
  });
  // Like counts per post
  await queryInterface.addIndex('likes', ['post_id'], { name: 'likes_post_id_idx' });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('likes');
};
