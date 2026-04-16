import { Router } from 'express';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  AlignmentType, LevelFormat,
} from 'docx';
import PDFDocument from 'pdfkit';
import { getReview, getImages, getRunMetadata } from './history-store.js';
import { sessionImages } from './upload-handler.js';

// ── Inline run parser ──────────────────────────────────────────────────

interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/**
 * Parse inline markdown markers into styled runs.
 * Handles **bold**, *italic*, __bold__, _italic_, `code`.
 */
function parseInline(raw: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Order matters: ** before * to avoid partial matches
  const regex = /(\*\*[\s\S]+?\*\*|__[\s\S]+?__|`[^`]+`|\*[\s\S]+?\*|_[\s\S]+?_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: raw.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), code: true });
    } else if (token.startsWith('**') || token.startsWith('__')) {
      runs.push({ text: token.slice(2, -2), bold: true });
    } else {
      runs.push({ text: token.slice(1, -1), italic: true });
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < raw.length) runs.push({ text: raw.slice(lastIndex) });
  return runs.filter((r) => r.text.length > 0);
}

function inlineToTextRuns(raw: string): TextRun[] {
  return parseInline(raw).map((r) =>
    new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      ...(r.code ? { font: 'Courier New', size: 18 } : {}),
    }),
  );
}

// ── Document node types ────────────────────────────────────────────────

type DocNode =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; raw: string }
  | { type: 'bullet'; raw: string; level: number }
  | { type: 'numbered'; raw: string; num: number }
  | { type: 'code_block'; text: string }
  | { type: 'image'; index: number }
  | { type: 'separator' };

function parseMarkdown(text: string): DocNode[] {
  const lines = text.split('\n');
  const nodes: DocNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    // Code fence
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        nodes.push({ type: 'code_block', text: codeLines.join('\n') });
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) { codeLines.push(line); continue; }

    // Headings
    const h6 = line.match(/^#{6}\s+(.+)/);
    const h5 = line.match(/^#{5}\s+(.+)/);
    const h4 = line.match(/^#{4}\s+(.+)/);
    const h3 = line.match(/^#{3}\s+(.+)/);
    const h2 = line.match(/^#{2}\s+(.+)/);
    const h1 = line.match(/^#{1}\s+(.+)/);
    if (h6) { nodes.push({ type: 'heading', level: 6, text: h6[1] }); continue; }
    if (h5) { nodes.push({ type: 'heading', level: 5, text: h5[1] }); continue; }
    if (h4) { nodes.push({ type: 'heading', level: 4, text: h4[1] }); continue; }
    if (h3) { nodes.push({ type: 'heading', level: 3, text: h3[1] }); continue; }
    if (h2) { nodes.push({ type: 'heading', level: 2, text: h2[1] }); continue; }
    if (h1) { nodes.push({ type: 'heading', level: 1, text: h1[1] }); continue; }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) { nodes.push({ type: 'separator' }); continue; }

    // Embedded image placeholder
    const img = line.match(/!\[Image (\d+)\]/i);
    if (img) { nodes.push({ type: 'image', index: parseInt(img[1], 10) - 1 }); continue; }

    // Bullet list (- item, * item, + item), with indent levels
    const bullet = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (bullet) {
      const level = Math.floor(bullet[1].length / 2);
      nodes.push({ type: 'bullet', raw: bullet[2], level });
      continue;
    }

    // Numbered list (1. item)
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (numbered) {
      nodes.push({ type: 'numbered', raw: numbered[2], num: parseInt(numbered[1], 10) });
      continue;
    }

    // Skip blank lines (they just add spacing; docx handles paragraph spacing)
    if (!line.trim()) continue;

    nodes.push({ type: 'paragraph', raw: line });
  }

  return nodes;
}

function headingLevelToDocx(level: number): typeof HeadingLevel[keyof typeof HeadingLevel] {
  const map: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  return map[level] ?? HeadingLevel.HEADING_3;
}

// ── Router ─────────────────────────────────────────────────────────────

export function createExportRouter(): Router {
  const router = Router();

  router.post('/export', async (req, res) => {
    const { runId, format = 'docx', docText: bodyDocText, accessToken } = req.body as {
      runId?: string; format?: string; docText?: string; accessToken?: string;
    };

    let docText = bodyDocText ?? '';
    let images: Array<{ index: number; mimeType: string; dataB64: string }> = [];

    if (runId) {
      const meta = getRunMetadata(runId);
      if (!meta?.accessToken || meta.accessToken !== accessToken) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const storedImages = getImages(runId);
      images = storedImages.map(({ imgIndex, mimeType, dataB64 }) => ({ index: imgIndex, mimeType, dataB64 }));
      if (!docText) {
        const review = getReview(runId);
        if (review) docText = review.editedDoc;
      }
    }
    if (images.length === 0 && runId && sessionImages.has(runId)) {
      images = (sessionImages.get(runId) ?? []).map(({ index, mimeType, dataB64 }) => ({ index, mimeType, dataB64 }));
    }

    const nodes = parseMarkdown(docText);

    // ── DOCX export ──────────────────────────────────────────────────
    if (format === 'docx') {
      const children: Paragraph[] = [];

      for (const node of nodes) {
        if (node.type === 'heading') {
          children.push(new Paragraph({
            heading: headingLevelToDocx(node.level),
            children: inlineToTextRuns(node.text),
          }));
        } else if (node.type === 'paragraph') {
          children.push(new Paragraph({ children: inlineToTextRuns(node.raw) }));
        } else if (node.type === 'bullet') {
          children.push(new Paragraph({
            bullet: { level: node.level },
            children: inlineToTextRuns(node.raw),
          }));
        } else if (node.type === 'numbered') {
          children.push(new Paragraph({
            numbering: { reference: 'numbered-list', level: 0 },
            children: inlineToTextRuns(node.raw),
          }));
        } else if (node.type === 'code_block') {
          for (const codeLine of (node.text || ' ').split('\n')) {
            children.push(new Paragraph({
              children: [new TextRun({ text: codeLine || ' ', font: 'Courier New', size: 18 })],
              spacing: { before: 0, after: 0 },
            }));
          }
        } else if (node.type === 'separator') {
          children.push(new Paragraph({
            border: { bottom: { style: 'single', size: 6, space: 1, color: 'AAAAAA' } },
            children: [],
          }));
        } else if (node.type === 'image') {
          const img = images.find((i) => i.index === node.index);
          if (img) {
            try {
              children.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({
                  data: Buffer.from(img.dataB64, 'base64'),
                  transformation: { width: 500, height: 350 },
                  type: (img.mimeType.split('/')[1] ?? 'png') as any,
                })],
              }));
            } catch {
              children.push(new Paragraph({ children: [new TextRun(`[Image ${node.index + 1}]`)] }));
            }
          }
        }
      }

      const doc = new Document({
        numbering: {
          config: [{
            reference: 'numbered-list',
            levels: [{
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            }],
          }],
        },
        sections: [{ children }],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="design-doc.docx"');
      res.send(buffer);

    // ── PDF export ───────────────────────────────────────────────────
    } else {
      const pdf = new PDFDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="design-doc.pdf"');
      pdf.pipe(res);

      for (const node of nodes) {
        if (node.type === 'heading') {
          const size = [0, 22, 18, 15, 13, 12, 11][node.level] ?? 13;
          pdf.fontSize(size).font('Helvetica-Bold').text(stripInline(node.text)).moveDown(0.3);
        } else if (node.type === 'paragraph') {
          pdf.fontSize(11).font('Helvetica').text(stripInline(node.raw), { lineGap: 3 }).moveDown(0.3);
        } else if (node.type === 'bullet') {
          const indent = 20 + node.level * 16;
          pdf.fontSize(11).font('Helvetica')
            .text(`• ${stripInline(node.raw)}`, { indent, lineGap: 2 })
            .moveDown(0.15);
        } else if (node.type === 'numbered') {
          pdf.fontSize(11).font('Helvetica')
            .text(`${node.num}. ${stripInline(node.raw)}`, { indent: 20, lineGap: 2 })
            .moveDown(0.15);
        } else if (node.type === 'code_block') {
          pdf.fontSize(9).font('Courier').text(node.text, { lineGap: 2 }).moveDown(0.4);
        } else if (node.type === 'separator') {
          pdf.moveDown(0.3)
            .moveTo(50, pdf.y).lineTo(pdf.page.width - 50, pdf.y)
            .strokeColor('#AAAAAA').stroke().strokeColor('#000000')
            .moveDown(0.3);
        } else if (node.type === 'image') {
          const img = images.find((i) => i.index === node.index);
          if (img) {
            try {
              pdf.image(Buffer.from(img.dataB64, 'base64'), { fit: [500, 350], align: 'center' }).moveDown(0.5);
            } catch {
              pdf.fontSize(10).fillColor('gray').text(`[Image ${node.index + 1}]`).fillColor('black');
            }
          }
        }
      }

      pdf.end();
    }
  });

  return router;
}

/** Strip inline markdown markers for plain-text renderers (PDF). */
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}
