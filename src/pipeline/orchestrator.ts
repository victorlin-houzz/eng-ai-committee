import { runSecurityComplianceAgent } from './agents/security-compliance.js';
import { runArchitectureInfraAgent } from './agents/architecture-infra.js';
import { runProductOpsAgent } from './agents/product-ops.js';
import { runStructuralCheck } from './structural-check.js';
import { runDeduplication } from './deduplication.js';
import { runDebate } from './debate.js';
import { runJudge } from './agents/judge.js';
import { loadCheckpoint, saveCheckpoint, hashDoc, checkpointPath } from './checkpoint.js';
import { withTimeout } from './agents/base.js';
import type { AgentImage } from './agents/base.js';
import type { Config, Finding, JudgeVerdict } from '../types.js';
import type { PipelineEventEmitter } from './events.js';

/** ~100K tokens ≈ 400K chars. Truncate long docs to avoid exceeding context limits. */
const MAX_DOC_CHARS = 400_000;
const SPECIALIST_MAX_ATTEMPTS = 2;
/** Per-agent API call timeout in milliseconds. gpt-5.4 with high reasoning on a full doc can take 8–10 min. */
const AGENT_TIMEOUT_MS = 600_000;

export interface PipelineResult {
  verdict: JudgeVerdict;
  allFindings: Finding[];
  skippedAgents: string[];
  resumedFromCheckpoint: boolean;
}

type SpecialistRunner = (docText: string, model: string, images: AgentImage[], signal?: AbortSignal) => Promise<Finding[]>;

const SPECIALISTS: Array<{ name: string; run: SpecialistRunner }> = [
  { name: 'security-compliance', run: runSecurityComplianceAgent },
  { name: 'architecture-infra', run: runArchitectureInfraAgent },
  { name: 'product-ops', run: runProductOpsAgent },
];

async function runSpecialistWithRetry(
  specialist: { name: string; run: SpecialistRunner },
  docText: string,
  images: AgentImage[],
  model: string,
  onProgress: (message: string) => void,
  onEvent: PipelineEventEmitter,
): Promise<Finding[]> {
  let lastError: unknown;
  const agentName = specialist.name as Parameters<PipelineEventEmitter>[0] extends { agent: infer A } ? A : never;

  for (let attempt = 1; attempt <= SPECIALIST_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      const isAbort = lastError instanceof Error && lastError.name === 'AbortError';
      const isTimeout = lastError instanceof Error && lastError.message.startsWith('Agent timed out');
      const reason = (isAbort || isTimeout)
        ? `Timed out (exceeded ${AGENT_TIMEOUT_MS / 1000}s limit)`
        : (lastError instanceof Error ? lastError.message : String(lastError));
      onEvent({ type: 'agent:retry', agent: specialist.name as any, attempt, reason });
      onProgress(`Retrying ${specialist.name} (${attempt - 1}/${SPECIALIST_MAX_ATTEMPTS - 1} retries used)...`);
    }

    // Always emit thinking so the UI shows an active indicator on every attempt
    onEvent({ type: 'agent:thinking', agent: specialist.name as any, message: attempt === 1 ? 'Reviewing design document...' : 'Retrying...' });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      onEvent({ type: 'agent:timeout', agent: specialist.name as any, retryingIn: 0 });
    }, AGENT_TIMEOUT_MS);

    try {
      // Pass signal so abort() actually cancels the in-flight HTTP request
      const findings = await specialist.run(docText, model, images, controller.signal);
      clearTimeout(timeoutId);
      return findings;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
    }
  }

  throw new Error(
    `${specialist.name} failed after ${SPECIALIST_MAX_ATTEMPTS} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function runPipeline(
  docText: string,
  config: Config,
  agentFilter: string,
  inputPath: string,
  onProgress: (message: string) => void,
  onEvent: PipelineEventEmitter = () => {},
  images: AgentImage[] = [],
): Promise<PipelineResult> {
  let text = docText;
  if (text.length > MAX_DOC_CHARS) {
    onProgress(`⚠  Document truncated from ${text.length.toLocaleString()} to ${MAX_DOC_CHARS.toLocaleString()} characters`);
    text = text.slice(0, MAX_DOC_CHARS);
  }

  // Load checkpoint if one exists for this doc
  const docHash = hashDoc(text);
  const cpPath = checkpointPath(inputPath);
  let cp = await loadCheckpoint(cpPath, docHash);
  const resumedFromCheckpoint = cp !== null;

  if (resumedFromCheckpoint) {
    onProgress(`Resuming from checkpoint (${cpPath})`);
  }

  // Stage 1: Structural pre-check
  onEvent({ type: 'stage:start', stage: 'structural-check' });
  if (!cp?.structuralCheck) {
    onProgress('Running structural pre-check...');
    const structuralCheck = await withTimeout(runStructuralCheck(text, config.dedupModel), 60_000, 'Structural check');
    cp = { ...cp, version: '1', docPath: inputPath, docHash, createdAt: cp?.createdAt ?? new Date().toISOString(), structuralCheck };
    await saveCheckpoint(cpPath, cp);

    if (!structuralCheck.pass) {
      onProgress(`Structural check failed: missing ${structuralCheck.missingSections.join(', ')}`);
      const verdict: JudgeVerdict = {
        verdict: 'Reject',
        confidence: 100,
        topBlockingIssues: [],
        revisionMemo: `Document is missing required sections: ${structuralCheck.missingSections.join(', ')}. Please add these before resubmitting.`,
        agentDebateSummary: 'Review terminated at structural pre-check — required sections missing.',
      };
      onEvent({ type: 'judge:verdict', verdict });
      const result: PipelineResult = { verdict, allFindings: [], skippedAgents: [], resumedFromCheckpoint };
      onEvent({ type: 'pipeline:complete', result });
      return result;
    }
  } else {
    onProgress(`Structural check: loaded from checkpoint (${cp.structuralCheck.pass ? 'pass' : 'fail'})`);
    if (!cp.structuralCheck.pass) {
      const verdict: JudgeVerdict = {
        verdict: 'Reject',
        confidence: 100,
        topBlockingIssues: [],
        revisionMemo: `Document is missing required sections: ${cp.structuralCheck.missingSections.join(', ')}.`,
        agentDebateSummary: 'Review terminated at structural pre-check — required sections missing.',
      };
      onEvent({ type: 'judge:verdict', verdict });
      const result: PipelineResult = { verdict, allFindings: [], skippedAgents: [], resumedFromCheckpoint };
      onEvent({ type: 'pipeline:complete', result });
      return result;
    }
  }

  // Stage 2: Specialist agents
  onEvent({ type: 'stage:start', stage: 'specialists' });
  let specialistFindings: Finding[];
  const skippedAgents: string[] = [];

  if (cp?.specialistFindings) {
    specialistFindings = cp.specialistFindings;
    onProgress(`Specialist findings: loaded ${specialistFindings.length} from checkpoint`);
    // Emit done events for each agent so UI shows their findings
    for (const specialist of SPECIALISTS) {
      const agentFindings = specialistFindings.filter((f) => f.agent.includes(specialist.name.split('-')[0]));
      onEvent({ type: 'agent:done', agent: specialist.name as any, findingCount: agentFindings.length });
    }
  } else {
    const activeSpecialists =
      agentFilter === 'all'
        ? SPECIALISTS
        : SPECIALISTS.filter((s) => agentFilter.split(',').some((f) => s.name.includes(f)));

    onProgress(`Running ${activeSpecialists.length} specialist agents in parallel...`);

    const results = await Promise.allSettled(
      activeSpecialists.map(async (s) => {
        const findings = await runSpecialistWithRetry(s, text, images, config.specialistModel, onProgress, onEvent);
        onEvent({ type: 'agent:done', agent: s.name as any, findingCount: findings.length });
        for (const finding of findings) {
          onEvent({ type: 'agent:finding', agent: s.name as any, finding });
        }
        return findings;
      }),
    );

    specialistFindings = [];
    const failures: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        specialistFindings.push(...result.value);
      } else {
        const name = activeSpecialists[i].name;
        skippedAgents.push(name);
        failures.push(`${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    });

    if (failures.length > 0) {
      const message = `Specialist stage failed. Incomplete review coverage.\n${failures.join('\n')}`;
      onEvent({ type: 'pipeline:error', message });
      throw new Error(message);
    }

    cp = { ...cp!, specialistFindings };
    await saveCheckpoint(cpPath, cp);
  }

  // Stage 3: Deduplication
  onEvent({ type: 'stage:start', stage: 'deduplication' });
  let dedupedFindings: Finding[];
  if (cp?.dedupedFindings) {
    dedupedFindings = cp.dedupedFindings;
    onProgress(`Deduplication: loaded ${dedupedFindings.length} findings from checkpoint`);
    onEvent({ type: 'dedup:complete', before: specialistFindings.length, after: dedupedFindings.length });
  } else {
    onProgress(`${specialistFindings.length} raw findings. Running deduplication...`);
    dedupedFindings = await withTimeout(runDeduplication(specialistFindings, config.dedupModel), 90_000, 'Deduplication');
    onEvent({ type: 'dedup:complete', before: specialistFindings.length, after: dedupedFindings.length });
    cp = { ...cp!, dedupedFindings };
    await saveCheckpoint(cpPath, cp);
  }

  // Stage 4: Debate
  onEvent({ type: 'stage:start', stage: 'debate' });
  let debateState = cp?.debateState;
  if (debateState) {
    onProgress(`Debate: loaded from checkpoint (${debateState.survivingFindings.length} surviving findings)`);
  } else {
    // Cap findings entering debate: keep all Critical + up to 5 non-Critical per agent.
    // Prevents large docs from generating 60–90+ parallel rebuttal calls.
    const MAX_NON_CRITICAL_PER_AGENT = 5;
    const SEVERITY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const agentBuckets = new Map<string, Finding[]>();
    for (const f of dedupedFindings) {
      const bucket = agentBuckets.get(f.agent) ?? [];
      bucket.push(f);
      agentBuckets.set(f.agent, bucket);
    }
    const cappedFindings: Finding[] = [];
    for (const bucket of agentBuckets.values()) {
      const sorted = [...bucket].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4),
      );
      const criticals = sorted.filter((f) => f.severity === 'Critical');
      const nonCriticals = sorted.filter((f) => f.severity !== 'Critical').slice(0, MAX_NON_CRITICAL_PER_AGENT);
      cappedFindings.push(...criticals, ...nonCriticals);
    }
    if (cappedFindings.length < dedupedFindings.length) {
      onProgress(
        `Capped debate input: ${dedupedFindings.length} → ${cappedFindings.length} findings (all Critical + top 5 per agent)`,
      );
    }
    onProgress(`${cappedFindings.length} findings entering debate (${config.maxDebateRounds} round(s))...`);
    debateState = await runDebate(cappedFindings, config, onEvent);
    cp = { ...cp!, debateState };
    await saveCheckpoint(cpPath, cp);
  }

  // Stage 5: Judge
  onEvent({ type: 'stage:start', stage: 'judge' });
  let verdict = cp?.verdict;
  if (verdict) {
    onProgress(`Verdict: loaded from checkpoint (${verdict.verdict})`);
    onEvent({ type: 'judge:verdict', verdict });
  } else {
    onProgress(`Debate complete. ${debateState.survivingFindings.length} survived. Running judge...`);
    onEvent({ type: 'judge:thinking' });
    verdict = await runJudge(debateState, cp!.structuralCheck!, config.judgeModel);
    onEvent({ type: 'judge:verdict', verdict });
    cp = { ...cp!, verdict };
    await saveCheckpoint(cpPath, cp);
  }

  const result: PipelineResult = {
    verdict,
    allFindings: dedupedFindings,
    skippedAgents,
    resumedFromCheckpoint,
  };
  onEvent({ type: 'pipeline:complete', result });
  return result;
}
