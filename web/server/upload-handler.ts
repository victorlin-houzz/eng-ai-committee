import multer from 'multer';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseUploadedInput } from './upload-parser.js';

const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

/** In-memory session storage for uploaded images (runId → images) */
export const sessionImages = new Map<string, Array<{ index: number; mimeType: string; dataUrl: string; dataB64: string }>>();

export function createUploadRouter(): Router {
  const router = Router();

  router.post('/upload', upload.single('doc'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { path: tmpPath, originalname, mimetype } = req.file;
    // multer gives a random filename without extension; rename with original ext for parsers
    const ext = originalname.includes('.') ? `.${originalname.split('.').pop()}` : '';
    const namedPath = join(tmpdir(), `upload-${randomUUID()}${ext}`);

    try {
      const { rename } = await import('node:fs/promises');
      await rename(tmpPath, namedPath);

      const { docText, images } = await parseUploadedInput(namedPath, originalname, mimetype);

      const runId = randomUUID();
      sessionImages.set(runId, images);

      // Expire session after 2 hours
      setTimeout(() => sessionImages.delete(runId), 2 * 60 * 60 * 1000);

      res.json({
        runId,
        filename: originalname,
        docText,
        images: images.map(({ index, mimeType, dataUrl }) => ({ index, mimeType, dataUrl })),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      await unlink(namedPath).catch(() => {});
    }
  });

  return router;
}
