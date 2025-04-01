import express from 'express';
import { sendMessage } from './controllers/message.controller';

export const router = express.Router();

router.post('/send', sendMessage);
