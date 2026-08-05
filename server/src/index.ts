import express, { Request, Response, Application, NextFunction } from 'express';
import authRouter from './auth/auth.router';
import userRouter from './user/routers/user.router';
import { errorMiddleware } from './error-handling/middlewares/error.middleware';
import { connectDB } from './config/db';
import config from './config/config';
import { logger } from './utils/logger';
import messageRouter from './messenger/routers/message.router';
import conversationRouter from './messenger/routers/conversation.router';
import {
  closeWebSocketServer,
  setupWebSocket,
  webSocketServiceInstance,
} from './websocket/websocket.setup';
import { INSTANCE_ID } from './websocket/services/websocket.service';

import cors from 'cors';
import http from 'http';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
// import morgan from 'morgan';
import mongoSanitize from '@exortek/express-mongo-sanitize';
import hpp from 'hpp';
import {
  authenticateToken,
  requireVerifiedEmail,
} from './auth/middlewares/auth.middleware';

import { connectRedis, redisClient, redisSubscriber } from './config/redis';
import {
  generalLimiter,
  identifyForRateLimit,
  initLimiters,
} from './auth/middlewares/rate-limiter';
import mongoose from 'mongoose';
import uploadRouter from './upload/upload.router';
import notificationsRouter from './messenger/routers/notifications.router';
import {
  csrfProtection,
  ensureCsrfCookie,
} from './auth/middlewares/csrf.middleware';

const app: Application = express();
const port: number | 3000 = parseInt(config.port.toString());

app.get('/health-check', (req: Request, res: Response) => {
  res.status(200).send('OK');
  logger.info('Health check');
});

app.set('trust proxy', config.trustedProxies);

const server = http.createServer(app);

app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['X-CSRF-Token'],
  }),
);

setupWebSocket(server);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'http://localhost:3000'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

app.use(compression());
app.use(mongoSanitize());
app.use(hpp());

// Middlewares

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(cookieParser());
// app.use(morgan('combined'));

/*
 * CSRF and the general limiter are applied to every route below, /auth
 * included.
 *
 * `app.use(csrfProtection)` used to sit *after* the /auth mount, so none of
 * login, register, refresh, reset-password, verify-email or unlock-account was
 * covered — and with SameSite=None in production, that is a live login-CSRF and
 * forced-refresh surface. The auth router re-applied csrfProtection to a
 * handful of its own routes, which is what made the gap easy to miss.
 *
 * The limiter has the same story: every other mount had it, /auth did not, so
 * `DELETE /auth/2fa` and `POST /auth/2fa/confirm` accepted unlimited six-digit
 * guesses. Login and forgot-password keep their own stricter per-identity
 * limiters on top of this one.
 *
 * `identifyForRateLimit` must precede the limiter: it is the only thing that
 * runs before the routers and can tell one signed-in user from another, and
 * without it every authenticated request fell into a shared per-IP bucket.
 */
app.use(identifyForRateLimit);
app.use(generalLimiter);
app.use(ensureCsrfCookie);
app.use(csrfProtection);

app.use('/auth', authRouter);

/*
 * `requireVerifiedEmail` gates the messaging surface. The verification flow was
 * fully built — token, mail, endpoint, a flag on the user — and nothing ever
 * read the flag, so any address could be used indefinitely.
 *
 * /user is intentionally not gated: an unverified account still needs to read
 * its own profile, see that it is unverified, and request a new link.
 */
app.use('/user', authenticateToken, userRouter);
app.use(
  '/conversations',
  authenticateToken,
  requireVerifiedEmail,
  conversationRouter,
);
app.use('/messages', authenticateToken, requireVerifiedEmail, messageRouter);
app.use(
  '/notifications',
  authenticateToken,
  requireVerifiedEmail,
  notificationsRouter,
);
app.use('/upload', authenticateToken, requireVerifiedEmail, uploadRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

/*
 * Node terminates the process on an unhandled rejection by default (>= 15), so
 * one stray promise anywhere in a request path would drop every websocket
 * connection on this instance. Log it loudly and stay up — for a chat server a
 * missed background task beats disconnecting everyone. This is a safety net,
 * not a licence to skip .catch() at the call site.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

/*
 * Everything the server depends on is connected *before* the port is opened.
 *
 * These used to run inside the `listen` callback, so there was a window in
 * which the socket accepted requests while Redis was still connecting. Any
 * request arriving in it reached `authenticateToken`, whose blacklist check
 * throws when Redis is not ready, and came back as "403 Invalid token" — a
 * failure that reads like a credential problem and is not one. The rate
 * limiters, initialised in the same callback, fail open until they exist.
 */
const start = async (): Promise<void> => {
  await connectDB();
  await connectRedis();
  initLimiters();
  await webSocketServiceInstance.registerInstance();

  await redisSubscriber.subscribe('ws:broadcast', (rawMessage) => {
    try {
      const { participantIds, payload, fromInstance } = JSON.parse(rawMessage);
      if (fromInstance === INSTANCE_ID) return;
      for (const userId of participantIds) {
        webSocketServiceInstance.sendToUser(userId, payload);
      }
    } catch (err) {
      logger.error('Redis sub parse error:', err);
    }
  });

  await redisSubscriber.subscribe('ws:notification', (raw) => {
    try {
      const { userId, notification } = JSON.parse(raw);
      webSocketServiceInstance.sendToUser(userId, notification);
    } catch (err) {
      logger.error('Notification sub error:', err);
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  logger.info(`Server listening on port ${port}`);
};

/*
 * Graceful shutdown. The worker already had this; the API had nothing, so a
 * redeploy severed every open WebSocket mid-frame and left connections to
 * Mongo and Redis to be reclaimed by process death.
 */
let shuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down...`);

  // Stop accepting new work first, then let in-flight requests finish.
  server.close(() => logger.info('HTTP server closed'));

  const timeout = setTimeout(() => {
    logger.warn('Shutdown timed out, exiting anyway');
    process.exit(1);
  }, 15_000);
  timeout.unref?.();

  try {
    webSocketServiceInstance?.stopInstance();
    await closeWebSocketServer();
    await Promise.allSettled([
      redisSubscriber.quit(),
      redisClient.quit(),
      mongoose.disconnect(),
    ]);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});

export {};
