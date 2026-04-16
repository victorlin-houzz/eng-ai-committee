import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { parseDocument } from '../../src/parsers/index.js';
import { extractImages, type ExtractedImage } from './image-extractor.js';

const ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
]);

const TEXT_ENTRY_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.markdown',
  '.txt',
  '.pdf',
  '.docx',
]);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

function isZipUpload(originalname: string, mimetype: string): boolean {
  return extname(originalname).toLowerCase() === '.zip' || ZIP_MIME_TYPES.has(mimetype);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isMarkdownLike(ext: string): boolean {
  return ext === '.md' || ext === '.mdx' || ext === '.markdown' || ext === '.txt';
}

async function parseSingleFile(filePath: string): Promise<{ docText: string; images: ExtractedImage[] }> {
  const ext = extname(filePath).toLowerCase();
  const docText = await parseDocument(filePath);
  const rawContent = isMarkdownLike(ext) ? await readFile(filePath, 'utf-8') : undefined;
  const images = await extractImages(filePath, rawContent);
  return { docText, images };
}

function canParseAsText(ext: string): boolean {
  return TEXT_ENTRY_EXTENSIONS.has(ext);
}

export async function parseUploadedInput(
  filePath: string,
  originalname: string,
  mimetype: string,
): Promise<{ docText: string; images: ExtractedImage[] }> {
  if (!isZipUpload(originalname, mimetype)) {
    return parseSingleFile(filePath);
  }

  const zipBuffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => !entry.name.startsWith('__MACOSX/'))
    .filter((entry) => basename(entry.name) !== '.DS_Store')
    .sort((a, b) => a.name.localeCompare(b.name));

  const extractRoot = join(tmpdir(), `upload-unzip-${randomUUID()}`);
  await mkdir(extractRoot, { recursive: true });

  try {
    const textSections: string[] = [];
    const imageSections: string[] = [];
    const images: ExtractedImage[] = [];

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const ext = extname(entry.name).toLowerCase();

      if (IMAGE_MIME_BY_EXTENSION[ext]) {
        const imageBuffer = await entry.async('nodebuffer');
        const dataB64 = imageBuffer.toString('base64');
        const mimeType = IMAGE_MIME_BY_EXTENSION[ext];
        images.push({
          index: images.length,
          mimeType,
          dataUrl: `data:${mimeType};base64,${dataB64}`,
          dataB64,
        });
        imageSections.push(`- ${entry.name}`);
        continue;
      }

      if (!canParseAsText(ext)) {
        continue;
      }

      const contentBuffer = await entry.async('nodebuffer');
      const entryName = `${String(i).padStart(3, '0')}-${sanitizeFilename(basename(entry.name))}`;
      const entryPath = join(extractRoot, entryName);
      await writeFile(entryPath, contentBuffer);

      let docText = '';
      try {
        docText = await parseDocument(entryPath);
      } catch {
        continue;
      }

      if (docText.trim()) {
        textSections.push(`## File: ${entry.name}\n\n${docText.trim()}`);
      }

      const rawContent = isMarkdownLike(ext) ? contentBuffer.toString('utf-8') : undefined;
      const extracted = await extractImages(entryPath, rawContent);
      for (const img of extracted) {
        images.push({ ...img, index: images.length });
      }
    }

    if (imageSections.length > 0) {
      textSections.push(`## Images from archive\n\n${imageSections.join('\n')}`);
    }

    if (textSections.length === 0 && images.length === 0) {
      throw new Error('ZIP archive has no supported files. Include PDF, DOCX, Markdown, TXT, or image files.');
    }

    return {
      docText: textSections.join('\n\n---\n\n').trim(),
      images,
    };
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}
