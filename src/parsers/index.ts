import { extname } from 'path';
import { parsePdf } from './pdf.js';
import { parseMarkdown } from './markdown.js';
import { parseText } from './text.js';
import { parseDocx } from './docx.js';

export async function parseDocument(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    return parsePdf(filePath);
  }
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') {
    return parseMarkdown(filePath);
  }
  if (ext === '.docx') {
    return parseDocx(filePath);
  }
  return parseText(filePath);
}

/** Returns true if the input file is a Word document */
export function isDocxFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.docx';
}
