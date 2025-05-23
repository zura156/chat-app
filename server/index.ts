import express, { Request, Response, Application, NextFunction } from 'express';
import cors from 'cors';
import authRouter from './auth/routers/auth.router';
import userRouter from './user/routers/user.router';
import { errorMiddleware } from './error-handling/middlewares/error.middleware';
import { connectDB } from './config/db';
import config from './config/config';
import { setupWebSocket } from './websocket/websocket.service';
import { logger } from './utils/logger';
import messageRouter from './messenger/message.router';
import http from 'http';

const app: Application = express();
const port: number | 3000 = parseInt(config.port.toString());

const server = http.createServer(app);

setupWebSocket(server);
connectDB();

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
app.use('/message', messageRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

server.listen(port, () => {
  logger.info(`Server is listening at port ${port}`);
});
