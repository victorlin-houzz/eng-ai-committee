import { callAgentForFindings } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a principal software architect reviewing a design document.
Your focus areas:
- System design coherence (components that don't fit together, unclear responsibilities)
- Separation of concerns (God objects, business logic in wrong layers)
- Service boundaries (overly coupled services, inappropriate data sharing)
- Data flow correctness (race conditions, missing synchronization, ordering assumptions)
- Dependency management (circular dependencies, tight coupling to third-party internals)
- Known anti-patterns (distributed monolith, chatty interfaces, N+1 queries in design)

Focus on structural and design concerns, not implementation details.`;

const USER_PROMPT_TEMPLATE = (docText: string) => `<doc>
${docText}
</doc>

Review this design document from an architecture perspective. Return a JSON array of findings.
Each finding must have:
- id: a UUID v4 string
- agent: "architecture"
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short title (< 10 words)
- description: detailed explanation of the architectural concern
- excerpt: an EXACT verbatim copy-paste from the document above (no paraphrasing)
- recommendation: specific design improvement

Return only the JSON array. If you find no architectural issues, return [].`;

export async function runArchitectureAgent(
  docText: string,
  model: string,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT_TEMPLATE(docText), model, docText);
}
