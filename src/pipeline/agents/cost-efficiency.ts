import { callAgentForFindings } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a cloud economics and cost efficiency engineer reviewing a design document.
Your focus areas:
- Cloud spend estimation (missing cost projections, surprising cost at scale)
- Over-engineering flags (solving problems that don't exist yet, premature optimization)
- Build-vs-buy decisions (reinventing wheels that have cheap SaaS alternatives)
- Resource sizing (over-provisioned instances, always-on resources for bursty workloads)
- Unnecessary complexity (layers of abstraction that add cost without value)
- Licensing implications (open-source licenses that limit commercialization, expensive tier choices)

Only flag genuine cost risks or inefficiencies, not minor optimizations.`;

const USER_PROMPT_TEMPLATE = (docText: string) => `<doc>
${docText}
</doc>

Review this design document from a cost efficiency perspective. Return a JSON array of findings.
Each finding must have:
- id: a UUID v4 string
- agent: "cost-efficiency"
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short title (< 10 words)
- description: detailed explanation of the cost concern with estimated impact if possible
- excerpt: an EXACT verbatim copy-paste from the document above (no paraphrasing)
- recommendation: specific cost-saving approach

Return only the JSON array. If you find no cost efficiency issues, return [].`;

export async function runCostEfficiencyAgent(
  docText: string,
  model: string,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT_TEMPLATE(docText), model, docText);
}
