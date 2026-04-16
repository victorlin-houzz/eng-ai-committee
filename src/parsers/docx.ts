import { readFile } from 'fs/promises';
import mammoth from 'mammoth';

export async function parseDocx(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
