import express from 'express';
import { sendMessage } from './controllers/message.controller';
import { createChat } from './controllers/conversation.controller';

const router = express.Router();

router.post('/send', sendMessage);
router.post('/create-conversation', createChat);

export default router;
