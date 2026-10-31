import { Server } from 'socket.io';
import { socketCorsOptions } from '../config/cors.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import AppError from '../utils/AppError.js';

export const ADMIN_ROOM = 'admins';
export const userRoom = (userId) => `user:${userId}`;

let io = null;

/**
 * Attaches Socket.IO to the HTTP server.
 *
 * Clients connect with the JWT: io(url, { auth: { token } }).
 * Each socket is placed in its own user room (and the admin room for admins)
 * by the server. There is no client-side "join" event, so a client can never
 * subscribe to another user's notifications.
 *
 * Sockets only deliver events; the notifications table stays the source of truth.
 * Reconnecting clients fetch missed items from GET /api/notifications.
 */
export const initSocket = (httpServer) => {
  // Same allowed origins as the REST API (config/cors.js); unknown origins cannot open a socket
  io = new Server(httpServer, socketCorsOptions());

  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers.authorization || '';
      const token = socket.handshake.auth?.token || (header.startsWith('Bearer ') ? header.slice(7) : null);
      if (!token) {
        throw new AppError('Authentication required', 401);
      }

      const user = await authenticateToken(token);
      socket.data.user = { id: user.id, username: user.username, role: user.role };
      next();
    } catch (error) {
      next(new Error(error instanceof AppError ? error.message : 'Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.data.user;
    const rooms = [userRoom(id)];
    if (role === 'admin') rooms.push(ADMIN_ROOM);

    socket.join(rooms);
    socket.emit('connected', { user_id: id, rooms });
  });

  return io;
};

// The helpers below are no-ops when Socket.IO is not running (e.g. in HTTP-only tests)

export const emitToUser = (userId, event, payload) => {
  io?.to(userRoom(userId)).emit(event, payload);
};

export const emitToAdmins = (event, payload) => {
  io?.to(ADMIN_ROOM).emit(event, payload);
};

export const emitToAll = (event, payload) => {
  io?.emit(event, payload);
};

// Used when an account is deactivated or deleted
export const disconnectUser = (userId) => {
  io?.in(userRoom(userId)).disconnectSockets(true);
};

export const closeSocket = async () => {
  if (io) {
    await io.close();
    io = null;
  }
};
