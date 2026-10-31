import jwt from 'jsonwebtoken';

const { JWT_SECRET, JWT_EXPIRES_IN = '7d' } = process.env;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not defined. Add it to your .env file.');
}

// Token claims are informational; authMiddleware re-checks the user against the database
export const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

export const verifyToken = (token) => jwt.verify(token, JWT_SECRET);
