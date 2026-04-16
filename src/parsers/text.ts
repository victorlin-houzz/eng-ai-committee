import { readFile } from 'fs/promises';

export async function parseText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}
