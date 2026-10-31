import { sequelize, User, Profile } from '../models/index.js';
import AppError from '../utils/AppError.js';

const PROFILE_FIELDS = ['full_name', 'bio', 'avatar_url', 'location', 'website'];
const USER_FIELDS = ['username'];
const UPDATABLE_FIELDS = [...USER_FIELDS, ...PROFILE_FIELDS];

// Fields that exist on the account but can never be changed through this endpoint
const RESTRICTED_FIELDS = [
  'id', 'user_id', 'email', 'password', 'role', 'is_email_verified', 'is_active', 'created_at', 'updated_at',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Always return every profile field, as null when the user has no profile yet
const formatProfile = (profile) =>
  Object.fromEntries(PROFILE_FIELDS.map((field) => [field, profile?.[field] ?? null]));

const formatOwnProfile = (user, profile) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  is_email_verified: user.is_email_verified,
  created_at: user.created_at,
  updated_at: user.updated_at,
  profile: formatProfile(profile),
});

// GET /api/users/profile
export const getMyProfile = async (req, res) => {
  const profile = await Profile.findOne({ where: { user_id: req.user.id } });

  res.status(200).json({
    success: true,
    user: formatOwnProfile(req.user, profile),
  });
};

// PUT /api/users/profile
export const updateMyProfile = async (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Request body must be a JSON object', 400);
  }

  const keys = Object.keys(body);
  const restricted = keys.filter((key) => RESTRICTED_FIELDS.includes(key));
  if (restricted.length) {
    throw new AppError(`These fields cannot be updated here: ${restricted.join(', ')}`, 403);
  }

  const unknown = keys.filter((key) => !UPDATABLE_FIELDS.includes(key));
  if (unknown.length) {
    throw new AppError(`Unknown fields: ${unknown.join(', ')}. Allowed: ${UPDATABLE_FIELDS.join(', ')}`, 400);
  }
  if (!keys.length) {
    throw new AppError(`Provide at least one field to update: ${UPDATABLE_FIELDS.join(', ')}`, 400);
  }

  const invalidType = keys.filter((key) =>
    USER_FIELDS.includes(key) ? typeof body[key] !== 'string' : body[key] !== null && typeof body[key] !== 'string',
  );
  if (invalidType.length) {
    throw new AppError(`These fields must be strings: ${invalidType.join(', ')}`, 400);
  }

  const userUpdates = Object.fromEntries(USER_FIELDS.filter((f) => f in body).map((f) => [f, body[f]]));
  const profileUpdates = Object.fromEntries(PROFILE_FIELDS.filter((f) => f in body).map((f) => [f, body[f]]));

  // Ownership comes only from the JWT (req.user), never from the request body
  const { user, profile } = await sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });

    if (Object.keys(userUpdates).length) {
      await user.update(userUpdates, { transaction });
    }

    let [profile] = await Profile.findOrCreate({ where: { user_id: user.id }, transaction });
    if (Object.keys(profileUpdates).length) {
      profile = await profile.update(profileUpdates, { transaction });
    }

    return { user, profile };
  });

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user: formatOwnProfile(user, profile),
  });
};

// GET /api/users/:id
export const getPublicProfile = async (req, res) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    throw new AppError('Invalid user ID', 400);
  }

  // Only public columns are selected; email, role and account flags are never loaded
  const user = await User.findOne({
    where: { id, is_active: true },
    attributes: ['id', 'username', 'created_at'],
    include: [{ model: Profile, as: 'profile', attributes: PROFILE_FIELDS }],
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      joined_at: user.created_at,
      profile: formatProfile(user.profile),
    },
  });
};
