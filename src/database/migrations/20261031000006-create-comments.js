import { DataTypes } from 'sequelize';

export const up = async ({ context: queryInterface }) => {
  const { sequelize } = queryInterface;
  await queryInterface.createTable('comments', {
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
    content: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  });
  // Listing comments of a post in order, and comment counts
  await queryInterface.addIndex('comments', ['post_id', 'created_at'], { name: 'comments_post_id_created_at_idx' });
  await queryInterface.addIndex('comments', ['user_id'], { name: 'comments_user_id_idx' });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('comments');
};
