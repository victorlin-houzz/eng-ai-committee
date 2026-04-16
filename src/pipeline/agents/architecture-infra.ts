import { callAgentForFindings } from './base.js';
import type { AgentImage } from './base.js';
import type { Finding } from '../../types.js';

const SYSTEM_PROMPT = `You are a principal software architect and infrastructure engineer reviewing a design document.

ARCHITECTURE lens — look for:
- System design coherence (unclear component responsibilities, missing service boundaries)
- Separation of concerns (business logic in wrong layer, God objects)
- Data flow correctness (race conditions, missing synchronization, incorrect ordering assumptions)
- Anti-patterns (distributed monolith, N+1 queries, chatty interfaces)
- Dependency management (circular deps, tight coupling to third-party internals)

INFRASTRUCTURE & SCALABILITY lens — look for:
- Missing redundancy and failover design (single points of failure, no multi-AZ)
- Horizontal scaling gaps (stateful services without session affinity, missing autoscaling)
- Database bottlenecks (single writer, unsharded hot tables, missing read replicas)
- Caching issues (stampede, missing invalidation strategy, cache poisoning risk)
- Queue depth and backpressure (unbounded queues, missing dead-letter queues)
- Load pattern gaps (missing load estimates, thundering herd, undimensioned queues)
- Missing RTO/RPO definitions and failover runbooks

COST EFFICIENCY lens — look for:
- Surprising cloud spend at scale (missing cost estimates or projections)
- Over-engineering (solving problems that don't exist yet, premature optimization)
- Build-vs-buy decisions (reinventing cheap SaaS alternatives)
- Over-provisioned or always-on resources for bursty workloads
- Licensing implications (copyleft licenses that restrict commercialization, expensive managed-service tier choices)

Only flag genuine structural, infrastructure, or cost risks grounded in the document text — not general best practices that aren't specifically relevant to this design.`;

const USER_PROMPT = (docText: string) => `<doc>
${docText}
</doc>

Review this document for architecture, infrastructure, and cost issues. Return a JSON array of findings.
Each finding must include:
- id: UUID v4
- agent: "architecture", "infra-scalability", or "cost-efficiency" (whichever fits best)
- severity: "Low" | "Medium" | "High" | "Critical"
- title: short (< 10 words)
- description: detailed explanation of the risk and why it matters for this design
- excerpt: EXACT verbatim copy-paste from the document (no paraphrasing)
- recommendation: specific fix

Return only the JSON array. If no issues found, return [].

Focus on findings that would materially change the design. Skip theoretical concerns not evidenced in the document.`;

export async function runArchitectureInfraAgent(
  docText: string,
  model: string,
  images: AgentImage[],
  signal?: AbortSignal,
): Promise<Finding[]> {
  return callAgentForFindings(SYSTEM_PROMPT, USER_PROMPT(docText), model, docText, 'medium', images, signal);
}
