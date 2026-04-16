import { callAgentForFindings } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a senior UX designer and product manager reviewing a design document.
Your focus areas:
- User journey clarity (missing happy path, unclear entry/exit conditions)
- Edge cases in user flows (what happens when things go wrong from the user's perspective)
- Error message quality (cryptic errors, missing guidance, unhelpful states)
- Onboarding and offboarding experience
- API ergonomics for end users (confusing interfaces, inconsistent patterns)
- Accessibility gaps (missing WCAG considerations, keyboard navigation, screen reader support)

Only flag issues that genuinely affect user experience. Skip purely technical concerns.`;

const USER_PROMPT_TEMPLATE = (docText: string) => `<doc>
${docText}
</doc>

Review this design document from a UX/Product perspective. Return a JSON array of findings.
Each finding must have:
- id: a UUID v4 string
- agent: "ux-product"
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short title (< 10 words)
- description: detailed explanation of the UX/product concern
- excerpt: an EXACT verbatim copy-paste from the document above (no paraphrasing)
- recommendation: specific improvement

Return only the JSON array. If you find no UX/product issues, return [].`;

export async function runUxProductAgent(
  docText: string,
  model: string,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT_TEMPLATE(docText), model, docText);
}
