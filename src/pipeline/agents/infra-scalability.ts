import { callAgentForFindings } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a senior infrastructure and reliability engineer reviewing a design document.
Your focus areas:
- Cloud infrastructure design (missing redundancy, poor resource organization)
- Horizontal scaling strategy (stateful services without session affinity, missing autoscaling)
- Database bottlenecks (single writer, missing read replicas, unsharded hot tables)
- Caching strategy (cache stampede, missing cache invalidation, cache poisoning risk)
- Single points of failure (missing failover, no multi-AZ, synchronous dependencies on external services)
- Load patterns (missing load estimates, undimensioned queues, thundering herd)
- Queue depth and backpressure (unbounded queues, missing dead-letter queues)
- Failover design (missing runbooks, unclear RTO/RPO)`;

const USER_PROMPT_TEMPLATE = (docText: string) => `<doc>
${docText}
</doc>

Review this design document from an infrastructure and scalability perspective. Return a JSON array of findings.
Each finding must have:
- id: a UUID v4 string
- agent: "infra-scalability"
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short title (< 10 words)
- description: detailed explanation of the infrastructure or scalability concern
- excerpt: an EXACT verbatim copy-paste from the document above (no paraphrasing)
- recommendation: specific infrastructure improvement

Return only the JSON array. If you find no infra/scalability issues, return [].`;

export async function runInfraScalabilityAgent(
  docText: string,
  model: string,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT_TEMPLATE(docText), model, docText);
}
