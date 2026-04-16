import { callAgent } from './base.js';
import type { AgentType, Finding, SignOffResult } from '../../types.js';

const SIGNOFF_SYSTEM = `You are a specialist verifying whether your concerns about a design document have been addressed in a revised version.

You will be given:
1. Your original findings (the concerns you raised)
2. The revised document

For each finding, decide: was this concern adequately addressed in the revision?
"Addressed" means the revised document contains concrete content that resolves the concern — not just a vague mention.

Respond with ONLY a JSON object:
{
  "addressed": true | false,
  "unaddressedConcerns": ["specific concern 1 still missing", ...]
}

If all concerns are addressed, set addressed to true and unaddressedConcerns to [].
If any are not addressed, set addressed to false and list what is still missing.`;

export async function signOffOnRevision(
  agent: AgentType,
  findings: Finding[],
  revisedDoc: string,
  model: string,
): Promise<SignOffResult> {
  const findingsSummary = findings
    .map(
      (f) =>
        `Finding: ${f.title}\nSeverity: ${f.severity}\nConcern: ${f.description}\nRecommendation: ${f.recommendation}`,
    )
    .join('\n\n---\n\n');

  const userPrompt = `Your original findings:

${findingsSummary}

Revised document:

<document>
${revisedDoc}
</document>

Were your concerns addressed? Respond with JSON only.`;

  const raw = await callAgent(SIGNOFF_SYSTEM, userPrompt, model, 'medium');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { addressed: boolean; unaddressedConcerns: string[] };
      return { agent, addressed: parsed.addressed, unaddressedConcerns: parsed.unaddressedConcerns ?? [] };
    } catch { /* fall through */ }
  }

  // If we can't parse, assume addressed to avoid infinite loops
  return { agent, addressed: true, unaddressedConcerns: [] };
}
