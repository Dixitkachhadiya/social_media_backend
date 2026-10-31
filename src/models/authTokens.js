import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

// Shared shape for single-use, expiring codes/tokens. Only a hash is stored:
// HMAC-SHA256 for 6-digit OTP codes, SHA-256 for 256-bit random session tokens.
const tokenAttributes = {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  token_hash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  used_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Incorrect guesses against this code
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
};

const tokenOptions = (tableName) => ({
  tableName,
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: false,
});

export const EmailVerification = sequelize.define(
  'EmailVerification',
  tokenAttributes,
  tokenOptions('email_verifications'),
);

export const PASSWORD_RESET_KINDS = ['otp', 'session'];

export const PasswordReset = sequelize.define(
  'PasswordReset',
  {
    ...tokenAttributes,
    // 'otp': the emailed 6-digit code; 'session': the token issued after the code was verified
    kind: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'otp',
      validate: { isIn: [PASSWORD_RESET_KINDS] },
    },
  },
  tokenOptions('password_resets'),
);
