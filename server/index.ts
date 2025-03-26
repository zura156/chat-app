import express, { Request, Response, Application, NextFunction } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';
import authRouter from './auth/routers/auth.router';
import userRouter from './user/routers/user.router';
import { errorMiddleware } from './middlewares/error.middleware';
import { connectDB } from './config/db';
import config from './config/config';

const app: Application = express();
const port: number | 3000 = parseInt(config.port.toString());
const ws = new WebSocketServer({ port: parseInt(config.wsPort.toString()) });

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

ws.on('connection', (ws: WebSocket) => {
  ws.on('send-message', (message: Buffer) => {});
  ws.send('Hello! Message from server!');
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
