import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

// Trim strings and store empty strings as NULL so optional fields can be cleared
const optionalText = (field) => ({
  set(value) {
    const normalized = typeof value === 'string' ? value.trim() : value;
    this.setDataValue(field, normalized === '' ? null : normalized);
  },
});

// Custom validators also run for NULL (unlike built-ins), so allow empty values explicitly
const isHttpUrl = (fieldLabel) => (value) => {
  if (value === null || value === undefined) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldLabel} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${fieldLabel} must start with http:// or https://`);
  }
};

/**
 * Public-facing profile details, one per user.
 * Account data (username, email, role, status) stays on the User model.
 */
const Profile = sequelize.define(
  'Profile',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: { name: 'profiles_user_id_key' },
    },
    full_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      ...optionalText('full_name'),
      validate: {
        len: { args: [1, 100], msg: 'Full name must be at most 100 characters' },
      },
    },
    bio: {
      type: DataTypes.STRING(500),
      allowNull: true,
      ...optionalText('bio'),
      validate: {
        len: { args: [1, 500], msg: 'Bio must be at most 500 characters' },
      },
    },
    avatar_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      ...optionalText('avatar_url'),
      validate: {
        len: { args: [1, 500], msg: 'Avatar URL must be at most 500 characters' },
        isHttpUrl: isHttpUrl('Avatar URL'),
      },
    },
    location: {
      type: DataTypes.STRING(100),
      allowNull: true,
      ...optionalText('location'),
      validate: {
        len: { args: [1, 100], msg: 'Location must be at most 100 characters' },
      },
    },
    website: {
      type: DataTypes.STRING(255),
      allowNull: true,
      ...optionalText('website'),
      validate: {
        len: { args: [1, 255], msg: 'Website must be at most 255 characters' },
        isHttpUrl: isHttpUrl('Website'),
      },
    },
  },
  {
    tableName: 'profiles',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);

export default Profile;
