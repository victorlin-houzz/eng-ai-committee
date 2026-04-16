import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StructuralCheckResult, Finding, DebateState, JudgeVerdict } from '../../types.js';

// Mock all IO-bound modules before importing the orchestrator
vi.mock('../structural-check.js', () => ({ runStructuralCheck: vi.fn() }));
vi.mock('../deduplication.js', () => ({ runDeduplication: vi.fn() }));
vi.mock('../debate.js', () => ({ runDebate: vi.fn() }));
vi.mock('../agents/judge.js', () => ({ runJudge: vi.fn() }));
vi.mock('../agents/security-compliance.js', () => ({ runSecurityComplianceAgent: vi.fn() }));
vi.mock('../agents/architecture-infra.js', () => ({ runArchitectureInfraAgent: vi.fn() }));
vi.mock('../agents/product-ops.js', () => ({ runProductOpsAgent: vi.fn() }));
vi.mock('../checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  hashDoc: vi.fn().mockReturnValue('abc123'),
  checkpointPath: vi.fn().mockReturnValue('/tmp/test.checkpoint.json'),
}));

import { runPipeline } from '../orchestrator.js';
import { runStructuralCheck } from '../structural-check.js';
import { runDeduplication } from '../deduplication.js';
import { runDebate } from '../debate.js';
import { runJudge } from '../agents/judge.js';
import { runSecurityComplianceAgent } from '../agents/security-compliance.js';
import { runArchitectureInfraAgent } from '../agents/architecture-infra.js';
import { runProductOpsAgent } from '../agents/product-ops.js';
import { loadCheckpoint, saveCheckpoint } from '../checkpoint.js';

const mockStructuralCheck = vi.mocked(runStructuralCheck);
const mockDedup = vi.mocked(runDeduplication);
const mockDebate = vi.mocked(runDebate);
const mockJudge = vi.mocked(runJudge);
const mockSecurity = vi.mocked(runSecurityComplianceAgent);
const mockArchitecture = vi.mocked(runArchitectureInfraAgent);
const mockProductOps = vi.mocked(runProductOpsAgent);
const mockLoadCheckpoint = vi.mocked(loadCheckpoint);
const mockSaveCheckpoint = vi.mocked(saveCheckpoint);

const CONFIG = {
  specialistModel: 'spec-model',
  judgeModel: 'judge-model',
  skepticModel: 'skeptic-model',
  dedupModel: 'dedup-model',
  maxDebateRounds: 1,
  apiKey: 'test-key',
};

const PASS_STRUCT: StructuralCheckResult = { pass: true, missingSections: [] };

function sampleFinding(id: string): Finding {
  return {
    id,
    agent: 'security',
    severity: 'Medium',
    title: 'Test finding',
    description: 'desc',
    excerpt: 'some text',
    recommendation: 'fix it',
  };
}

const PASS_VERDICT: JudgeVerdict = {
  verdict: 'Pass',
  confidence: 90,
  topBlockingIssues: [],
  agentDebateSummary: 'All good.',
  committeeBrief: 'Looks great.',
};

const PASS_DEBATE_STATE: DebateState = {
  rounds: [],
  survivingFindings: [],
};

function setupHappyPath(findings: Finding[] = []) {
  mockLoadCheckpoint.mockResolvedValue(null);
  mockSaveCheckpoint.mockResolvedValue(undefined);
  mockStructuralCheck.mockResolvedValue(PASS_STRUCT);
  mockSecurity.mockResolvedValue(findings);
  mockArchitecture.mockResolvedValue([]);
  mockProductOps.mockResolvedValue([]);
  mockDedup.mockResolvedValue(findings);
  mockDebate.mockResolvedValue({ ...PASS_DEBATE_STATE, survivingFindings: findings });
  mockJudge.mockResolvedValue(PASS_VERDICT);
}

describe('runPipeline — happy path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a Pass verdict when all stages succeed with no findings', async () => {
    setupHappyPath();
    const result = await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    expect(result.verdict.verdict).toBe('Pass');
    expect(result.allFindings).toEqual([]);
    expect(result.skippedAgents).toEqual([]);
    expect(result.resumedFromCheckpoint).toBe(false);
  });

  it('calls all three specialist agents', async () => {
    setupHappyPath();
    await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    expect(mockSecurity).toHaveBeenCalledWith('doc text', 'spec-model', [], expect.any(AbortSignal));
    expect(mockArchitecture).toHaveBeenCalledWith('doc text', 'spec-model', [], expect.any(AbortSignal));
    expect(mockProductOps).toHaveBeenCalledWith('doc text', 'spec-model', [], expect.any(AbortSignal));
  });

  it('pipes specialist findings through dedup → debate → judge', async () => {
    const f = sampleFinding('f1');
    setupHappyPath([f]);
    await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    expect(mockDedup).toHaveBeenCalledWith([f], 'dedup-model');
    expect(mockDebate).toHaveBeenCalledWith([f], CONFIG, expect.any(Function));
    expect(mockJudge).toHaveBeenCalled();
  });

  it('checkpoints are saved at each stage', async () => {
    setupHappyPath();
    await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    // Saves after: structural check, specialist findings, dedup, debate, judge = 5 saves
    expect(mockSaveCheckpoint).toHaveBeenCalledTimes(5);
  });
});

describe('runPipeline — structural check failure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns Reject early when structural check fails', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);
    mockSaveCheckpoint.mockResolvedValue(undefined);
    mockStructuralCheck.mockResolvedValue({ pass: false, missingSections: ['problem statement'] });

    const result = await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    expect(result.verdict.verdict).toBe('Reject');
    expect(mockSecurity).not.toHaveBeenCalled();
    expect(mockDedup).not.toHaveBeenCalled();
    expect(mockDebate).not.toHaveBeenCalled();
  });

  it('revisionMemo mentions the missing sections', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);
    mockSaveCheckpoint.mockResolvedValue(undefined);
    mockStructuralCheck.mockResolvedValue({
      pass: false,
      missingSections: ['problem statement', 'success criteria'],
    });

    const result = await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    expect(result.verdict.revisionMemo).toMatch(/problem statement/);
    expect(result.verdict.revisionMemo).toMatch(/success criteria/);
  });
});

describe('runPipeline — agent failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries a failed specialist once before succeeding', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);
    mockSaveCheckpoint.mockResolvedValue(undefined);
    mockStructuralCheck.mockResolvedValue(PASS_STRUCT);
    mockSecurity
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce([sampleFinding('f1')]);
    mockArchitecture.mockResolvedValue([]);
    mockProductOps.mockResolvedValue([]);
    mockDedup.mockResolvedValue([sampleFinding('f1')]);
    mockDebate.mockResolvedValue({ ...PASS_DEBATE_STATE, survivingFindings: [sampleFinding('f1')] });
    mockJudge.mockResolvedValue(PASS_VERDICT);

    const result = await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    expect(mockSecurity).toHaveBeenCalledTimes(2);
    expect(result.skippedAgents).toEqual([]);
    expect(result.verdict.verdict).toBe('Pass');
  });

  it('fails the pipeline when a specialist still fails after retry', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);
    mockSaveCheckpoint.mockResolvedValue(undefined);
    mockStructuralCheck.mockResolvedValue(PASS_STRUCT);
    mockSecurity.mockRejectedValue(new Error('API timeout'));
    mockArchitecture.mockResolvedValue([]);
    mockProductOps.mockResolvedValue([]);

    await expect(runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {})).rejects.toThrow(
      /Specialist stage failed/,
    );
    expect(mockSecurity).toHaveBeenCalledTimes(2);
    expect(mockDedup).not.toHaveBeenCalled();
    expect(mockDebate).not.toHaveBeenCalled();
    expect(mockJudge).not.toHaveBeenCalled();
  });
});

describe('runPipeline — agent filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only runs agents matching the filter', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);
    mockSaveCheckpoint.mockResolvedValue(undefined);
    mockStructuralCheck.mockResolvedValue(PASS_STRUCT);
    mockSecurity.mockResolvedValue([]);
    mockDedup.mockResolvedValue([]);
    mockDebate.mockResolvedValue(PASS_DEBATE_STATE);
    mockJudge.mockResolvedValue(PASS_VERDICT);

    await runPipeline('doc text', CONFIG, 'security', '/tmp/doc.md', () => {});
    expect(mockSecurity).toHaveBeenCalled();
    expect(mockArchitecture).not.toHaveBeenCalled();
    expect(mockProductOps).not.toHaveBeenCalled();
  });
});

describe('runPipeline — checkpoint resume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips all stages and returns from fully cached checkpoint', async () => {
    const cachedVerdict: JudgeVerdict = {
      verdict: 'Revise',
      confidence: 70,
      topBlockingIssues: [],
      agentDebateSummary: 'Cached.',
    };

    mockLoadCheckpoint.mockResolvedValue({
      version: '1',
      docPath: '/tmp/doc.md',
      docHash: 'abc123',
      createdAt: '2024-01-01T00:00:00Z',
      structuralCheck: PASS_STRUCT,
      specialistFindings: [],
      dedupedFindings: [],
      debateState: PASS_DEBATE_STATE,
      verdict: cachedVerdict,
    });

    const result = await runPipeline('doc text', CONFIG, 'all', '/tmp/doc.md', () => {});
    expect(result.resumedFromCheckpoint).toBe(true);
    expect(result.verdict.verdict).toBe('Revise');
    // No LLM calls
    expect(mockStructuralCheck).not.toHaveBeenCalled();
    expect(mockSecurity).not.toHaveBeenCalled();
    expect(mockJudge).not.toHaveBeenCalled();
  });
});

describe('runPipeline — document truncation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('truncates documents longer than 400K chars', async () => {
    const longDoc = 'a'.repeat(500_000);
    setupHappyPath();
    const messages: string[] = [];
    await runPipeline(longDoc, CONFIG, 'all', '/tmp/doc.md', (msg) => messages.push(msg));
    expect(messages.some((m) => m.includes('truncated'))).toBe(true);
    // Agents receive truncated text, not the full 500K
    const [docArg] = mockSecurity.mock.calls[0];
    expect(docArg.length).toBe(400_000);
  });
});
