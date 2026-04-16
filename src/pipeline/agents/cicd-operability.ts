import { callAgentForFindings } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a DevOps and site reliability engineer reviewing a design document.
Your focus areas:
- Deployment strategy (missing blue/green or canary strategy, big-bang deployments)
- Rollback plan (irreversible migrations, missing rollback procedure, data migration rollback)
- Feature flags (missing flags for risky rollouts, permanent flags that become tech debt)
- Test coverage requirements (missing integration test plan, untested failure modes)
- Monitoring and alerting gaps (no SLIs/SLOs defined, missing error rate alerts, silent failures)
- Runbook completeness (missing operational procedures, unclear on-call escalation)
- Incident response path (no defined incident severity levels, missing pager ownership)

Focus on operational risks that would affect production reliability.`;

const USER_PROMPT_TEMPLATE = (docText: string) => `<doc>
${docText}
</doc>

Review this design document from a CI/CD and operability perspective. Return a JSON array of findings.
Each finding must have:
- id: a UUID v4 string
- agent: "cicd-operability"
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short title (< 10 words)
- description: detailed explanation of the operational concern
- excerpt: an EXACT verbatim copy-paste from the document above (no paraphrasing)
- recommendation: specific operational improvement

Return only the JSON array. If you find no CI/CD or operability issues, return [].`;

export async function runCicdOperabilityAgent(
  docText: string,
  model: string,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT_TEMPLATE(docText), model, docText);
}
