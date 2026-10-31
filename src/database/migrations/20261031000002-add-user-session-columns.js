import { DataTypes } from 'sequelize';

// password_changed_at invalidates JWTs issued before a password reset;
// last_login_at powers "recent logins" on the admin dashboard.
export const up = async ({ context: queryInterface }) => {
  await queryInterface.addColumn('users', 'password_changed_at', { type: DataTypes.DATE, allowNull: true });
  await queryInterface.addColumn('users', 'last_login_at', { type: DataTypes.DATE, allowNull: true });
  await queryInterface.addIndex('users', ['created_at'], { name: 'users_created_at_idx' });
  await queryInterface.addIndex('users', ['last_login_at'], { name: 'users_last_login_at_idx' });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.removeIndex('users', 'users_last_login_at_idx');
  await queryInterface.removeIndex('users', 'users_created_at_idx');
  await queryInterface.removeColumn('users', 'last_login_at');
  await queryInterface.removeColumn('users', 'password_changed_at');
};
