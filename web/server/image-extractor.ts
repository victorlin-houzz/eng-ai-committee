import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mammoth: any = createRequire(import.meta.url)('mammoth');
import path from 'node:path';

export interface ExtractedImage {
  index: number;
  mimeType: string;
  dataUrl: string;
  dataB64: string;
}

/**
 * Extract embedded images from DOCX files using mammoth's image handler.
 */
async function extractFromDocx(filePath: string): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = [];
  let index = 0;

  await mammoth.convertToHtml(
    { path: filePath },
    {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const buffer = await image.read('base64') as string;
        const mimeType = image.contentType ?? 'image/png';
        const dataUrl = `data:${mimeType};base64,${buffer}`;
        images.push({ index, mimeType, dataUrl, dataB64: buffer });
        index += 1;
        return { src: `[Image ${index}]` };
      }),
    },
  );

  return images;
}

/**
 * Scan markdown/text for existing data: URLs or local image references.
 * For markdown files that already embed base64 images.
 */
function extractFromMarkdown(content: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const imgRegex = /!\[[^\]]*\]\((data:([^;]+);base64,([^)]+))\)/g;
  let match;
  let index = 0;
  while ((match = imgRegex.exec(content)) !== null) {
    const mimeType = match[2];
    const dataB64 = match[3];
    images.push({
      index,
      mimeType,
      dataUrl: match[1],
      dataB64,
    });
    index += 1;
  }
  return images;
}

/** Max pages to render from a PDF (keeps memory and API token usage bounded). */
const PDF_MAX_PAGES = 20;

/**
 * Render each page of a PDF to a PNG image so that diagrams, flowcharts, and
 * other vector/raster graphics are visible to the agent.
 */
async function extractFromPdf(filePath: string): Promise<ExtractedImage[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Resolve the worker using the same createRequire trick used for mammoth,
  // then convert to a file:// URL that pdfjs-dist can load as a Worker.
  const _require = createRequire(import.meta.url);
  const workerPath = _require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const data = await readFile(filePath);
  const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const numPages = Math.min(pdfDoc.numPages as number, PDF_MAX_PAGES);
  const images: ExtractedImage[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width as number), Math.ceil(viewport.height as number));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const pngBuffer = canvas.toBuffer('image/png');
    const dataB64 = pngBuffer.toString('base64');
    images.push({
      index: pageNum - 1,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${dataB64}`,
      dataB64,
    });
  }

  return images;
}

export async function extractImages(filePath: string, content?: string): Promise<ExtractedImage[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') return extractFromDocx(filePath);
  if ((ext === '.md' || ext === '.txt') && content) return extractFromMarkdown(content);
  if (ext === '.pdf') return extractFromPdf(filePath);
  return [];
}
