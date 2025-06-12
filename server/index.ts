import express, { Request, Response, Application, NextFunction } from 'express';
import cors from 'cors';
import authRouter from './auth/routers/auth.router';
import userRouter from './user/routers/user.router';
import { errorMiddleware } from './error-handling/middlewares/error.middleware';
import { connectDB } from './config/db';
import config from './config/config';
import { logger } from './utils/logger';
import messageRouter from './messenger/routers/message.router';
import conversationRouter from './messenger/routers/conversation.router';
import http from 'http';
import {
  getBroadcastFunction,
  setupWebSocket,
} from './websocket/websocket.setup';
import path from 'path';

const app: Application = express();
const port: number | 3000 = parseInt(config.port.toString());

const server = http.createServer(app);

setupWebSocket(server);
// ---------------------------------------------
const broadcastMessage = getBroadcastFunction();
app.set('broadcastMessage', broadcastMessage);
// ---------------------------------------------
connectDB();

app.use('/uploads', express.static(path.resolve('uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  })
);

app.use('/auth', authRouter);
app.use('/user', userRouter);
app.use('/conversations', conversationRouter);
app.use('/messages', messageRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

server.listen(port, () => {
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
