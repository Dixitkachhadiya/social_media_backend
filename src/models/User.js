import { DataTypes } from 'sequelize';
import bcrypt from 'bcryptjs';
import sequelize from '../config/database.js';

const SALT_ROUNDS = 12;

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      set(value) {
        this.setDataValue('username', typeof value === 'string' ? value.trim() : value);
      },
      validate: {
        notNull: { msg: 'Username is required' },
        notEmpty: { msg: 'Username cannot be empty' },
        len: { args: [3, 50], msg: 'Username must be between 3 and 50 characters' },
      },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: { name: 'users_email_key', msg: 'Email is already registered' },
      set(value) {
        // Normalize so uniqueness is effectively case-insensitive
        this.setDataValue('email', typeof value === 'string' ? value.trim().toLowerCase() : value);
      },
      validate: {
        notNull: { msg: 'Email is required' },
        isEmail: { msg: 'Email must be a valid email address' },
      },
    },
    password: {
      // Validated as plain text, then replaced with a bcrypt hash by the beforeSave hook
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notNull: { msg: 'Password is required' },
        notEmpty: { msg: 'Password cannot be empty' },
        // bcrypt only uses the first 72 bytes of input
        len: { args: [8, 72], msg: 'Password must be between 8 and 72 characters' },
      },
    },
    role: {
      type: DataTypes.ENUM('user', 'admin'),
      allowNull: false,
      defaultValue: 'user',
      validate: {
        isIn: { args: [['user', 'admin']], msg: 'Role must be either user or admin' },
      },
    },
    is_email_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    // Tokens issued before this moment are rejected (set when the password changes)
    password_changed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_login_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'users',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      // Case-insensitive uniqueness: "John" and "john" cannot both exist,
      // while the stored username keeps the user's chosen casing for display
      {
        name: 'users_username_lower_unique',
        unique: true,
        fields: [sequelize.fn('lower', sequelize.col('username'))],
      },
    ],
    // Never return the password unless explicitly requested via User.scope('withPassword')
    defaultScope: {
      attributes: { exclude: ['password'] },
    },
    scopes: {
      withPassword: {
        attributes: { include: ['password'] },
      },
    },
  },
);

// Hash the password whenever it is set or changed (runs after validation)
User.beforeSave(async (user) => {
  if (user.changed('password')) {
    user.password = await bcrypt.hash(user.password, SALT_ROUNDS);
    if (!user.isNewRecord) {
      user.password_changed_at = new Date();
    }
  }
});

// Requires the instance to be loaded with User.scope('withPassword')
User.prototype.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Strip the password from any serialized instance (e.g. res.json(user))
User.prototype.toJSON = function toJSON() {
  const values = { ...this.get() };
  delete values.password;
  return values;
};

export default User;
