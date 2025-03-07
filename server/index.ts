import express, { Request, Response, Application, NextFunction } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import cors from 'cors';
import { authRouter } from './auth/routers/auth.router';
import { errorMiddleware } from './middlewares/error.middleware';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { connectDB } from './config/db';

dotenv.config();
connectDB();

const app: Application = express();
const port: number | 3000 = process.env['PORT']
  ? Number(process.env['PORT'])
  : 3000;
const ws = new WebSocketServer({ port: port + 1 });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Session configuration
app.use(
  session({
    secret: 'your_secret_key', // In production, use environment variables
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env['MONGO_URI'],
      ttl: 14 * 24 * 60 * 60, // 14 days
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production', // true in production
      httpOnly: true,
      maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days in milliseconds
    },
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
