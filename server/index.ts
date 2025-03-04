import express, { Request, Response, Application } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import cors from 'cors';
import { authRouter } from './auth/routers/auth.router';

dotenv.config();

const app: Application = express();
const port: number | 3000 = process.env['PORT']
  ? Number(process.env['PORT'])
  : 3000;
const ws = new WebSocketServer({ port: port + 1 });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use('/auth', authRouter);

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World');
});

ws.on('connection', (ws: WebSocket) => {
  ws.on('message', (message: Buffer) => {
    const messageText = message.toString();

    console.log(`Received initial message: ${message}`);
    console.log(`Received message: ${messageText}`);
    ws.send(messageText);
  });
});

app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
