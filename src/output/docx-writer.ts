import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
} from 'docx';
import { writeFile } from 'fs/promises';

interface DocNode {
  type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'listitem';
  text: string;
}

/**
 * Parse a markdown string into a flat list of document nodes.
 * Handles: # ## ### headings, - * bullet lists, blank lines, plain paragraphs.
 * Inline bold (**text**) and italic (*text*) are preserved in TextRun segments.
 */
function parseMarkdownNodes(markdown: string): DocNode[] {
  const nodes: DocNode[] = [];
  const lines = markdown.split('\n');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;

    if (line.startsWith('### ')) {
      nodes.push({ type: 'heading3', text: line.slice(4) });
    } else if (line.startsWith('## ')) {
      nodes.push({ type: 'heading2', text: line.slice(3) });
    } else if (line.startsWith('# ')) {
      nodes.push({ type: 'heading1', text: line.slice(2) });
    } else if (/^[-*+]\s/.test(line)) {
      nodes.push({ type: 'listitem', text: line.replace(/^[-*+]\s/, '') });
    } else {
      nodes.push({ type: 'paragraph', text: line });
    }
  }

  return nodes;
}

/**
 * Split a text string containing **bold** and *italic* markers into TextRun segments.
 */
function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Match **bold**, *italic*, or plain text
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|([^*]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined) {
      runs.push(new TextRun({ text: match[1], bold: true }));
    } else if (match[2] !== undefined) {
      runs.push(new TextRun({ text: match[2], italics: true }));
    } else if (match[3] !== undefined) {
      runs.push(new TextRun({ text: match[3] }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text })];
}

function nodeToParagraph(node: DocNode): Paragraph {
  const runs = parseInline(node.text);

  switch (node.type) {
    case 'heading1':
      return new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs });
    case 'heading2':
      return new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs });
    case 'heading3':
      return new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs });
    case 'listitem':
      return new Paragraph({ bullet: { level: 0 }, children: runs });
    default:
      return new Paragraph({ children: runs, alignment: AlignmentType.LEFT });
  }
}

/**
 * Convert a markdown string to a .docx file at the given output path.
 * The resulting .docx uses standard Word heading styles (Heading 1/2/3, Normal, List Bullet)
 * which Google Docs preserves on import.
 */
export async function writeDocx(markdownText: string, outputPath: string): Promise<void> {
  const nodes = parseMarkdownNodes(markdownText);
  const paragraphs = nodes.map(nodeToParagraph);

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(outputPath, buffer);
}
