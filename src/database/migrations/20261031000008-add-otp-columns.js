import { DataTypes } from 'sequelize';

// Email verification and password reset move from emailed links to 6-digit OTP codes.
// - attempts: incorrect guesses against a code; the code is invalidated after the limit
// - password_resets.kind: 'otp' (emailed code) or 'session' (short-lived token issued after
//   a correct code, used to set the new password). Existing rows become 'otp' rows whose
//   hashes can never match a code, so outstanding link tokens simply stop working.
export const up = async ({ context: queryInterface }) => {
  await queryInterface.addColumn('email_verifications', 'attempts', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await queryInterface.addColumn('password_resets', 'attempts', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await queryInterface.addColumn('password_resets', 'kind', { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'otp' });
  await queryInterface.addIndex('password_resets', ['user_id', 'kind', 'created_at'], { name: 'password_resets_user_id_kind_created_at_idx' });
};

export const down = async ({ context: queryInterface }) => {
  await queryInterface.removeIndex('password_resets', 'password_resets_user_id_kind_created_at_idx');
  await queryInterface.removeColumn('password_resets', 'kind');
  await queryInterface.removeColumn('password_resets', 'attempts');
  await queryInterface.removeColumn('email_verifications', 'attempts');
};
