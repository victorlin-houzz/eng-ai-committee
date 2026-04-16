import { callAgentForFindings } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a compliance and legal engineer reviewing a design document.
Your focus areas:
- GDPR requirements (lawful basis, data subject rights, right to erasure, portability)
- SOC2 control gaps (access controls, audit logging, change management)
- CCPA/CPRA applicability (California consumer rights, opt-out mechanisms)
- HIPAA applicability (PHI handling, BAAs, minimum necessary standard)
- PII data retention policies (undefined retention periods, missing deletion workflows)
- Audit trail requirements (missing event logs, immutable audit records)
- Consent mechanisms (implicit consent, missing consent records)
- Cross-border data transfer (Schrems II, SCCs, data residency)

Only flag genuine compliance risks, not aspirational best practices.`;

const USER_PROMPT_TEMPLATE = (docText: string) => `<doc>
${docText}
</doc>

Review this design document from a compliance and legal perspective. Return a JSON array of findings.
Each finding must have:
- id: a UUID v4 string
- agent: "compliance"
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short title (< 10 words)
- description: detailed explanation of the compliance risk and which regulation applies
- excerpt: an EXACT verbatim copy-paste from the document above (no paraphrasing)
- recommendation: specific remediation

Return only the JSON array. If you find no compliance issues, return [].`;

export async function runComplianceAgent(
  docText: string,
  model: string,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT_TEMPLATE(docText), model, docText);
}
