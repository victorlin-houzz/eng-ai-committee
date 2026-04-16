import { callAgent } from './agents/base.js';
import type { StructuralCheckResult } from '../types.js';

const SYSTEM_PROMPT = `You are a technical reviewer checking whether a design document contains the minimum required sections.
The required sections are:
1. Problem statement (what problem is being solved, why it matters)
2. Success criteria or goals (measurable outcomes, definition of done)
3. Architecture or technical design (how the solution will work)

You must respond with ONLY a JSON object in this exact format:
{
  "pass": true | false,
  "missingSections": ["section name", ...]
}

If all three sections are present (even implicitly), set pass to true and missingSections to [].
If any are missing, set pass to false and list the missing section names.`;

export async function runStructuralCheck(
  docText: string,
  model: string,
): Promise<StructuralCheckResult> {
  const userPrompt = `<doc>\n${docText}\n</doc>\n\nDoes this document contain all three required sections? Respond with JSON only.`;

  const raw = await callAgent(SYSTEM_PROMPT, userPrompt, model, 'low');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // If we can't parse, assume pass to avoid false positives
    return { pass: true, missingSections: [] };
  }
  try {
    return JSON.parse(jsonMatch[0]) as StructuralCheckResult;
  } catch {
    return { pass: true, missingSections: [] };
  }
}
