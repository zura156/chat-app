import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Ensure proper UTF-8 handling
    const originalName = Buffer.from(file.originalname, 'latin1').toString(
      'utf8'
    );
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + originalName);
  },
});

export const uploadMiddleware = multer({
  limits: { fileSize: 30 * 1024 * 1024 },
  storage,
  fileFilter: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString(
      'utf8'
    );
    cb(null, true);
  },
});
