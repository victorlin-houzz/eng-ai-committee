import { callAgentForFindings } from './base.js';
import type { AgentImage } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a senior product manager, UX designer, and DevOps engineer reviewing a design document.

UX/PRODUCT lens — look for:
- User journey clarity (missing happy path, unclear entry/exit conditions)
- Edge cases in user flows (what happens when things go wrong from the user's perspective)
- Error message quality (cryptic errors, missing guidance, unhelpful empty states)
- API ergonomics (confusing interfaces, inconsistent patterns)
- Accessibility gaps (missing WCAG considerations, keyboard navigation, screen reader support)
- Onboarding/offboarding experience gaps

CI/CD & OPERABILITY lens — look for:
- Missing deployment strategy (no blue/green or canary plan, big-bang deployments)
- Rollback plan (irreversible migrations, no rollback procedure, data migration rollback)
- Feature flag gaps (risky rollouts without flags; also permanent flags that become tech debt)
- Monitoring and alerting gaps (no SLIs/SLOs defined, missing error-rate alerts, silent failures)
- Runbook completeness (missing operational procedures, unclear on-call escalation)
- Incident response path (no severity definitions, unclear pager ownership)
- Test coverage requirements (missing integration test plan, untested failure modes)

Only flag issues that would materially affect user experience or production reliability — not theoretical concerns unsupported by the document text.`;

const USER_PROMPT = (docText: string) => `<doc>
${docText}
</doc>

Review this document for UX/product and operational concerns. Return a JSON array of findings.
Each finding must include:
- id: UUID v4
- agent: "ux-product" or "cicd-operability" (whichever fits best)
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short (< 10 words)
- description: detailed explanation of the user or operational impact
- excerpt: EXACT verbatim copy-paste from the document (no paraphrasing)
- recommendation: specific fix

Return only the JSON array. If no issues found, return [].

For UX findings focus on what real users would experience. For operability findings focus on what would page an on-call engineer or cause a failed deployment.`;

export async function runProductOpsAgent(
  docText: string,
  model: string,
  images: AgentImage[],
  signal?: AbortSignal,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT(docText), model, docText, 'medium', images, signal);
}
