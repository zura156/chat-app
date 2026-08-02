import { Router } from 'express';
import {
  getNotifications,
  markNotificationsAsSeen,
} from '../controllers/notifications.controller';

const router = Router();

// --- Routes ---
router.get('/', getNotifications);
router.patch('/seen', markNotificationsAsSeen);

export default router;
