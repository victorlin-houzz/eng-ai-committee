import { callAgent } from './agents/base.js';
import type { Finding } from '../types.js';

const SYSTEM_PROMPT = `You are a technical editor deduplicating a list of code review findings.
Your job: merge findings that describe the same underlying issue.
Rules:
- When two or more findings describe the same issue, keep the most detailed version
- Preserve all unique findings (do not remove findings that describe different issues)
- Keep the original id, agent, severity, excerpt, and other fields of the version you keep
- If findings from different agents describe the same issue, keep the highest severity and most detailed description
- Return only the deduplicated JSON array, nothing else`;

export async function runDeduplication(
  findings: Finding[],
  model: string,
): Promise<Finding[]> {
  if (findings.length === 0) return [];

  const userPrompt = `Here are the findings to deduplicate:\n${JSON.stringify(findings, null, 2)}\n\nReturn the deduplicated JSON array only.`;

  const raw = await callAgent(SYSTEM_PROMPT, userPrompt, model, 'low');
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return findings; // fallback: return original if parse fails

  try {
    return JSON.parse(jsonMatch[0]) as Finding[];
  } catch {
    return findings;
  }
}
