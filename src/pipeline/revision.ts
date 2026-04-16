import { rewriteDocument, rewriteForSpecificConcerns } from './agents/rewriter.js';
import { signOffOnRevision } from './agents/signoff.js';
import { writeFile } from 'fs/promises';
import { extname, join, dirname, basename } from 'path';
import { writeDocx } from '../output/docx-writer.js';
import type { AgentType, Config, Finding, RevisionResult } from '../types.js';

const MAX_ITERATIONS = 2;

function groupFindingsByAgent(findings: Finding[]): Map<AgentType, Finding[]> {
  const map = new Map<AgentType, Finding[]>();
  for (const f of findings) {
    const existing = map.get(f.agent) ?? [];
    existing.push(f);
    map.set(f.agent, existing);
  }
  return map;
}

async function writeRevisedDoc(markdownText: string, inputPath: string): Promise<string> {
  const dir = dirname(inputPath);
  const ext = extname(inputPath).toLowerCase();
  const base = basename(inputPath, extname(inputPath));

  if (ext === '.docx') {
    // Reconstruct as .docx so it can be re-imported into Google Docs / Word
    const outputPath = join(dir, `${base}-revised.docx`);
    await writeDocx(markdownText, outputPath);
    return outputPath;
  }

  // All other formats: write as markdown
  const outputPath = join(dir, `${base}-revised.md`);
  await writeFile(outputPath, markdownText, 'utf-8');
  return outputPath;
}

export async function runRevision(
  originalDoc: string,
  survivingFindings: Finding[],
  config: Config,
  inputPath: string,
  onProgress: (message: string) => void,
): Promise<RevisionResult> {
  if (survivingFindings.length === 0) {
    onProgress('No surviving findings — doc is already clean, no revision needed.');
    const outputPath = await writeRevisedDoc(originalDoc, inputPath);
    return { revisedDoc: originalDoc, signOffs: [], iterations: 0, outputPath };
  }

  onProgress(`Rewriting document to address ${survivingFindings.length} surviving findings...`);
  let revisedDoc = await rewriteDocument(originalDoc, survivingFindings, config.judgeModel);

  const findingsByAgent = groupFindingsByAgent(survivingFindings);
  let iterations = 1;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    onProgress(`Running specialist sign-off (iteration ${iter})...`);

    // All specialists with surviving findings sign off in parallel
    const signOffResults = await Promise.all(
      Array.from(findingsByAgent.entries()).map(([agent, findings]) =>
        signOffOnRevision(agent, findings, revisedDoc, config.specialistModel),
      ),
    );

    const unaddressed = signOffResults.filter((r) => !r.addressed);

    if (unaddressed.length === 0) {
      onProgress('All specialists signed off ✓');
      const outputPath = await writeRevisedDoc(revisedDoc, inputPath);
      return { revisedDoc, signOffs: signOffResults, iterations, outputPath };
    }

    onProgress(
      `${unaddressed.length} specialist(s) have unaddressed concerns: ${unaddressed.map((r) => r.agent).join(', ')}`,
    );

    if (iter < MAX_ITERATIONS) {
      const concerns = unaddressed.map((r) => ({ agent: r.agent, concerns: r.unaddressedConcerns }));
      revisedDoc = await rewriteForSpecificConcerns(revisedDoc, concerns, config.judgeModel);
      iterations++;
    } else {
      onProgress(`⚠  Max iterations reached. Some concerns may still be unaddressed.`);
      const outputPath = await writeRevisedDoc(revisedDoc, inputPath);
      return { revisedDoc, signOffs: signOffResults, iterations, outputPath };
    }
  }

  // Unreachable but TypeScript requires a return
  const outputPath = await writeRevisedDoc(revisedDoc, inputPath);
  return { revisedDoc, signOffs: [], iterations, outputPath };
}
