import { Response, NextFunction } from 'express';
import { SendMessageDto } from '../dto/send-message.dto';
import { createCustomError } from '../../error-handling/models/custom-api-error.model';
import { saveMessage } from '../services/message.service';
import { createNotification } from '../services/notification.service';

export const sendMessage = async (
  req: SendMessageDto,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { sender, conversation, content, type } = req.body.message;

    const message = await saveMessage({ sender, conversation, content, type });

    if (!message) {
      next(createCustomError('Error saving message!', 500));
      return;
    }

    // Create notifications for all participants (except the sender)
    await createNotification(sender, conversation, JSON.stringify(message._id));

    res.status(201).json(message);
  } catch (error: any) {
    if (error.message) {
      next(createCustomError(error.message, 400));
      return;
    }
    console.error(error);
    next(createCustomError('Error sending message!', 500));
  }
};
