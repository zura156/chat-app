import express, { Request, Response, Application, NextFunction } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';
import authRouter from './auth/routers/auth.router';
import { errorMiddleware } from './middlewares/error.middleware';
import session from 'express-session';
import MongoStore from 'connect-mongo';
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

ws.on('connection', (ws: WebSocket) => {
  ws.on('message', (message: Buffer) => {
    const messageText = message.toString();

    console.log(`Received initial message: ${message}`);
    console.log(`Received message: ${messageText}`);
    ws.send(messageText);
  });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
