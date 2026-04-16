import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateState, Finding, StructuralCheckResult } from '../../types.js';

vi.mock('../agents/base.js', () => ({
  callAgent: vi.fn(),
  callAgentForFindings: vi.fn(),
  initClient: vi.fn(),
}));

import { runJudge } from '../agents/judge.js';
import { callAgent } from '../agents/base.js';

const mockCallAgent = vi.mocked(callAgent);

const PASSING_STRUCT: StructuralCheckResult = { pass: true, missingSections: [] };

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'id-1',
    agent: 'security',
    severity: 'Medium',
    title: 'Test',
    description: 'desc',
    excerpt: 'some text',
    recommendation: 'fix it',
    ...overrides,
  };
}

function debateState(surviving: Finding[] = []): DebateState {
  return { rounds: [], survivingFindings: surviving };
}

function stubVerdict(override: object = {}) {
  mockCallAgent.mockResolvedValueOnce(
    JSON.stringify({ verdict: 'Pass', confidence: 80, topBlockingIssues: [], agentDebateSummary: 'ok', ...override }),
  );
}

describe('runJudge — verdict enforcement overrides LLM', () => {
  beforeEach(() => mockCallAgent.mockReset());

  it('Pass: no High/Critical survivors (LLM says Reject)', async () => {
    stubVerdict({ verdict: 'Reject' });
    const r = await runJudge(debateState([finding({ severity: 'Low' })]), PASSING_STRUCT, 'model');
    expect(r.verdict).toBe('Pass');
  });

  it('Pass: no survivors at all', async () => {
    stubVerdict({ verdict: 'Reject' });
    const r = await runJudge(debateState([]), PASSING_STRUCT, 'model');
    expect(r.verdict).toBe('Pass');
  });

  it('Pass: only Medium survivors', async () => {
    stubVerdict();
    const r = await runJudge(debateState([finding({ severity: 'Medium' })]), PASSING_STRUCT, 'model');
    expect(r.verdict).toBe('Pass');
  });

  it('Revise: 1 High (LLM says Pass)', async () => {
    stubVerdict({ verdict: 'Pass' });
    const r = await runJudge(debateState([finding({ severity: 'High' })]), PASSING_STRUCT, 'model');
    expect(r.verdict).toBe('Revise');
  });

  it('Revise: 2 High', async () => {
    stubVerdict({ verdict: 'Pass' });
    const r = await runJudge(
      debateState([finding({ id: '1', severity: 'High' }), finding({ id: '2', severity: 'High' })]),
      PASSING_STRUCT,
      'model',
    );
    expect(r.verdict).toBe('Revise');
  });

  it('Revise: 1 Critical', async () => {
    stubVerdict({ verdict: 'Pass' });
    const r = await runJudge(debateState([finding({ severity: 'Critical' })]), PASSING_STRUCT, 'model');
    expect(r.verdict).toBe('Revise');
  });

  it('Reject: 2 Critical', async () => {
    stubVerdict({ verdict: 'Pass' });
    const r = await runJudge(
      debateState([finding({ id: '1', severity: 'Critical' }), finding({ id: '2', severity: 'Critical' })]),
      PASSING_STRUCT,
      'model',
    );
    expect(r.verdict).toBe('Reject');
  });
});

describe('runJudge — topBlockingIssues', () => {
  beforeEach(() => mockCallAgent.mockReset());

  it('includes only High/Critical, capped at 5, sorted Critical-first', async () => {
    stubVerdict();
    const findings = [
      finding({ id: '1', severity: 'High' }),
      finding({ id: '2', severity: 'Critical' }),
      finding({ id: '3', severity: 'Medium' }), // should not appear
      finding({ id: '4', severity: 'High' }),
      finding({ id: '5', severity: 'Critical' }),
      finding({ id: '6', severity: 'High' }),
    ];
    const r = await runJudge(debateState(findings), PASSING_STRUCT, 'model');
    expect(r.topBlockingIssues).toHaveLength(5);
    expect(r.topBlockingIssues.every(f => f.severity === 'High' || f.severity === 'Critical')).toBe(true);
    expect(r.topBlockingIssues[0].severity).toBe('Critical');
  });
});

describe('runJudge — fallback when LLM returns garbage', () => {
  beforeEach(() => mockCallAgent.mockReset());

  it('falls back gracefully on non-JSON response', async () => {
    mockCallAgent.mockResolvedValueOnce('Sorry, I cannot process that.');
    const r = await runJudge(debateState([finding({ severity: 'High' })]), PASSING_STRUCT, 'model');
    expect(r.verdict).toBe('Revise'); // enforced by table
    expect(r.confidence).toBe(50); // fallback sentinel
  });

  it('falls back gracefully on malformed JSON', async () => {
    mockCallAgent.mockResolvedValueOnce('{ verdict: broken }');
    const r = await runJudge(debateState([]), PASSING_STRUCT, 'model');
    expect(r.verdict).toBe('Pass');
    expect(r.confidence).toBe(50);
  });
});
