import { callAgentForFindings } from './base.js';
import type { AgentImage } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a senior security engineer and compliance specialist reviewing a design document.

SECURITY lens — look for:
- Auth/authz design gaps (missing checks, privilege escalation paths)
- Data exposure (PII in logs, sensitive data in API responses)
- Injection vectors (SQL, command, LDAP, template injection)
- Secrets management (hardcoded credentials, insecure storage or transmission)
- Session management (token expiry, replay attacks, session fixation)
- Threat model gaps (unauthenticated endpoints, SSRF, CSRF, missing abuse cases)

COMPLIANCE lens — look for:
- GDPR (lawful basis, right to erasure, data portability, data subject rights)
- SOC2 control gaps (access control, audit logging, change management)
- CCPA/CPRA (California consumer rights, opt-out mechanisms)
- HIPAA applicability (PHI handling, BAAs, minimum necessary standard)
- PII data retention (undefined retention periods, missing deletion workflows)
- Consent mechanisms (implicit consent, missing consent records)
- Audit trail completeness (missing event logs, immutable audit records)
- Cross-border data transfer (Schrems II, SCCs, data residency requirements)

Only flag real, specific security or compliance risks grounded in the document — not general best-practice suggestions that aren't directly relevant to this design.`;

const USER_PROMPT = (docText: string) => `<doc>
${docText}
</doc>

Review this document for security and compliance issues. Return a JSON array of findings.
Each finding must include:
- id: UUID v4
- agent: "security" or "compliance" (whichever domain the finding belongs to)
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short (< 10 words)
- description: detailed explanation of the risk, which regulation or threat model applies, and why it matters for this design
- excerpt: EXACT verbatim copy-paste from the document (no paraphrasing)
- recommendation: specific fix

Return only the JSON array. If no issues found, return [].

Focus on findings where the design text gives concrete evidence of a gap. Skip generic warnings not tied to specific choices made in this document.`;

export async function runSecurityComplianceAgent(
  docText: string,
  model: string,
  images: AgentImage[],
  signal?: AbortSignal,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT(docText), model, docText, 'medium', images, signal);
}
