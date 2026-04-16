import { callAgent } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a senior technical writer revising a design document based on expert review findings.
Your job: produce a revised version of the document that directly addresses each finding's recommendation.

Rules:
- Preserve the document's original structure, headings, and voice
- Make targeted edits — do not rewrite sections that are not related to any finding
- For each finding, incorporate the recommendation naturally into the relevant section
- Do not add a "Review Findings" or "Change Log" section — the revision should read as a clean, updated document
- Return ONLY the revised document text, nothing else`;

export async function rewriteDocument(
  originalDoc: string,
  findings: Finding[],
  model: string,
): Promise<string> {
  const findingsSummary = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] ${f.title} (${f.agent})\n   Excerpt: "${f.excerpt.slice(0, 150)}"\n   Fix: ${f.recommendation}`,
    )
    .join('\n\n');

  const userPrompt = `Here is the original design document:

<document>
${originalDoc}
</document>

Here are the findings that must be addressed in the revision:

${findingsSummary}

Produce the revised document now. Return only the document text.`;

  return callAgent(SYSTEM_PROMPT, userPrompt, model, 'high');
}

export async function rewriteForSpecificConcerns(
  revisedDoc: string,
  concerns: Array<{ agent: string; concerns: string[] }>,
  model: string,
): Promise<string> {
  const concernsSummary = concerns
    .map((c) => `${c.agent}:\n${c.concerns.map((s) => `  - ${s}`).join('\n')}`)
    .join('\n\n');

  const userPrompt = `Here is the current draft of the revised document:

<document>
${revisedDoc}
</document>

The following specialist concerns were NOT yet adequately addressed:

${concernsSummary}

Revise the document to address these specific remaining concerns. Return only the revised document text.`;

  return callAgent(SYSTEM_PROMPT, userPrompt, model, 'high');
}
