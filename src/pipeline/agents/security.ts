import { callAgentForFindings } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a senior application security engineer reviewing a design document.
Your focus areas:
- Authentication and authorization design (missing authz checks, privilege escalation paths)
- Data exposure risks (PII handling, sensitive data in logs or API responses)
- Injection vectors (SQL, command, LDAP, template injection)
- Secrets management (hardcoded credentials, insecure secret storage or transmission)
- Session management (token expiry, replay attacks, session fixation)
- Threat model gaps (missing abuse cases, unauthenticated endpoints, SSRF, CSRF)

Be direct and specific. Only flag real security concerns, not general best-practice suggestions.
If a finding is not genuinely relevant to this document's security posture, skip it.`;

const USER_PROMPT_TEMPLATE = (docText: string) => `<doc>
${docText}
</doc>

Review this design document from a security perspective. Return a JSON array of findings.
Each finding must have:
- id: a UUID v4 string
- agent: "security"
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short title (< 10 words)
- description: detailed explanation of the risk
- excerpt: an EXACT verbatim copy-paste from the document above (no paraphrasing)
- recommendation: specific remediation

Return only the JSON array. If you find no security issues, return [].`;

export async function runSecurityAgent(
  docText: string,
  model: string,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT_TEMPLATE(docText), model, docText);
}
