// GET /api/admin/test
export const adminTest = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Admin access granted',
    admin: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
    },
  });
};
