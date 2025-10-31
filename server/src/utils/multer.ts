import multer from 'multer';

// At top level (if you want all routes to accept files)
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB limit
});
