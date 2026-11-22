import { Router } from 'express';
import { presignLimiter } from '../auth/middlewares/rate-limiter';
import {
  presign,
  confirm,
  getSignedDownloadUrl,
  getUploadStatus,
} from './upload.controller';

const router = Router();

// /upload
router.post('/presign', presignLimiter, presign);
router.post('/confirm', confirm);
router.get('/signed-url/:uploadId', getSignedDownloadUrl);
router.get('/:uploadId/status', getUploadStatus);

export default router;
