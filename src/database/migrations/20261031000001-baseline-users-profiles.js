import { DataTypes } from 'sequelize';

/**
 * Baseline: users and profiles were originally created by sequelize.sync().
 * Existing tables (and their data) are left untouched; they are only created
 * when missing, e.g. on a fresh or test database.
 */
export const up = async ({ context: queryInterface }) => {
  const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

  if (!tables.includes('users')) {
    await queryInterface.createTable('users', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      username: { type: DataTypes.STRING(50), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      password: { type: DataTypes.STRING(255), allowNull: false },
      role: { type: DataTypes.ENUM('user', 'admin'), allowNull: false, defaultValue: 'user' },
      is_email_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }
  await queryInterface.sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (lower(username))',
  );

  if (!tables.includes('profiles')) {
    await queryInterface.createTable('profiles', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      full_name: { type: DataTypes.STRING(100) },
      bio: { type: DataTypes.STRING(500) },
      avatar_url: { type: DataTypes.STRING(500) },
      location: { type: DataTypes.STRING(100) },
      website: { type: DataTypes.STRING(255) },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }
};

export const down = async () => {
  throw new Error('The baseline migration cannot be reverted automatically (it would drop user data).');
};
