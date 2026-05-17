import { Router } from 'express';
import { presignLimiter } from '../config/redis';
import { presign, confirm, getSignedDownloadUrl } from './upload.controller';

const router = Router();

// /upload
router.post('/presign', presignLimiter, presign);
router.post('/confirm', confirm);
router.get('/signed-url/:uploadId', getSignedDownloadUrl);

export default router;
