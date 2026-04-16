import { readFile } from 'fs/promises';
import pdfParse from 'pdf-parse';

export async function parsePdf(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}
