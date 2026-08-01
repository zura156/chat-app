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
  getBroadcastFunction,
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
import { authenticateToken } from './auth/middlewares/auth.middleware';

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import {
  connectRedis,
  redisSubscriber,
  generalLimiter,
  initLimiters,
} from './config/redis';
import uploadRouter from './upload/upload.router';
import notificationsRouter from './messenger/routers/notifications.router';
import { csrfProtection } from './auth/middlewares/csrf.middleware';

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

// ---------------------------------------------
const broadcastMessage = getBroadcastFunction();
app.set('broadcastMessage', broadcastMessage);
// ---------------------------------------------

connectDB();
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
ffmpeg.setFfmpegPath(ffmpegPath || '');
// app.use(morgan('combined'));

// Public routes
app.use('/auth', authRouter); // only logout is protected

// Protected routes
app.use(csrfProtection);
app.use('/user', generalLimiter, authenticateToken, userRouter);
app.use(
  '/conversations',
  generalLimiter,
  authenticateToken,
  conversationRouter,
);
app.use('/messages', generalLimiter, authenticateToken, messageRouter);
app.use(
  '/notifications',
  generalLimiter,
  authenticateToken,
  notificationsRouter,
);
app.use('/upload', generalLimiter, authenticateToken, uploadRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

server.listen(port, async () => {
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

  logger.info(`Server listening on port ${port}`);
});

declare global {
  namespace Express {
    export interface Request {
      messageController: import('./messenger/controllers/message.controller').MessageController;
      messageService: import('./messenger/services/message.service').MessageService;

      conversationController: import('./messenger/controllers/conversation.controller').ConversationController;
      conversationService: import('./messenger/services/conversation.service').ConversationService;
    }
  }
}

export {};
