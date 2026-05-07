import { Router, Request, Response } from 'express';
import { validateFiles } from './upload.validation';
// import { generatePresignedGets, generatePresignedPuts } from './upload.service';

const router = Router();

// POST /api/upload/init
router.post('/init', async (req: Request, res: Response) => {
  const { files } = req.body;

  const error = validateFiles(files);
  if (error) return res.status(400).json({ error });

  // const result = await generatePresignedPuts(files);
  // return res.json({ files: result });
});

// POST /api/upload/confirm
router.post('/confirm', async (req: Request, res: Response) => {
  const { files } = req.body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  // TODO: save metadata to DB here
  // await db.insert(files.map(f => ({ ...f, uploadedBy: req.user.id })));

  // const result = await generatePresignedGets(files);
  // return res.json({ files: result });
});

export default router;
