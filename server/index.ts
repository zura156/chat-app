import express, { Request, Response, Application, NextFunction } from 'express';
import cors from 'cors';
import authRouter from './auth/routers/auth.router';
import userRouter from './user/routers/user.router';
import { errorMiddleware } from './error-handling/middlewares/error.middleware';
import { connectDB } from './config/db';
import config from './config/config';
import { setupWebSocket } from './websocket/services/websocket.service';
import { logger } from './utils/logger';

const app: Application = express();
const port: number | 3000 = parseInt(config.port.toString());

setupWebSocket();
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
// app.use('/messages', messageRouter);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

app.listen(port, () => {
  logger.info(`Server is listening at port ${port}`);
});
