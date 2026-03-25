import { Router } from 'express';
import { getNotifications } from '../controllers/notifications.controller';

const router = Router();

// --- Routes ---
router.get('/', getNotifications);

export default router;
