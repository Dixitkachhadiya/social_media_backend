import { DataTypes } from 'sequelize';

export const up = async ({ context: queryInterface }) => {
  const { sequelize } = queryInterface;
  await queryInterface.createTable('posts', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: sequelize.literal('gen_random_uuid()') },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    content: { type: DataTypes.TEXT, allowNull: false },
    image_url: { type: DataTypes.STRING(500), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  });
  // Feed ordering and "posts by user" lookups
  await queryInterface.addIndex('posts', ['created_at'], { name: 'posts_created_at_idx' });
  await queryInterface.addIndex('posts', ['user_id', 'created_at'], { name: 'posts_user_id_created_at_idx' });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('posts');
};
