import express, { Request, Response, Application, NextFunction } from 'express';
import authRouter from './auth/routers/auth.router';
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
} from './websocket/websocket.setup';

import cors from 'cors';
import http from 'http';
import path from 'path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
// import morgan from 'morgan';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import { authenticateToken } from './auth/middlewares/auth.middleware';
import { validateCSRF } from './auth/middlewares/csrf.middleware';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { connectRedis } from './utils/redis';

const app: Application = express();
const port: number | 3000 = parseInt(config.port.toString());

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
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Optionally for COEP/COOP requirements:
    // res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    // res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  },
  express.static(path.resolve('uploads')),
);
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ limit: '30mb', extended: true }));
app.use(cookieParser());
ffmpeg.setFfmpegPath(ffmpegPath || '');
// app.use(morgan('combined'));

const generalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes
app.use('/auth', authRouter);

// Protected routes
app.use(validateCSRF);
app.use('/user', generalLimiter, authenticateToken, userRouter);
app.use(
  '/conversations',
  generalLimiter,
  authenticateToken,
  conversationRouter,
);
app.use('/messages', generalLimiter, authenticateToken, messageRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

server.listen(port, async () => {
  await connectRedis();
  logger.info(`Server is listening at port ${port}`);
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
