import { DataTypes } from 'sequelize';

// Single-use, expiring tokens. Only the SHA-256 hash of each token is stored.
const tokenTable = (sequelize) => ({
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: sequelize.literal('gen_random_uuid()') },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  used_at: { type: DataTypes.DATE, allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
});

export const up = async ({ context: queryInterface }) => {
  const { sequelize } = queryInterface;
  await queryInterface.createTable('email_verifications', tokenTable(sequelize));
  await queryInterface.addIndex('email_verifications', ['user_id', 'created_at'], { name: 'email_verifications_user_id_created_at_idx' });

  await queryInterface.createTable('password_resets', tokenTable(sequelize));
  await queryInterface.addIndex('password_resets', ['user_id', 'created_at'], { name: 'password_resets_user_id_created_at_idx' });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.dropTable('password_resets');
  await queryInterface.dropTable('email_verifications');
};
