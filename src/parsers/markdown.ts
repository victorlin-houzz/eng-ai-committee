import { readFile } from 'fs/promises';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt();

export async function parseMarkdown(filePath: string): Promise<string> {
  const raw = await readFile(filePath, 'utf-8');
  const html = md.render(raw);
  // Strip HTML tags, collapse whitespace
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
