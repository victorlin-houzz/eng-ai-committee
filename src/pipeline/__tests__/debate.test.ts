import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Finding } from '../../types.js';

vi.mock('../agents/base.js', async () => {
  const actual = await vi.importActual<typeof import('../agents/base.js')>('../agents/base.js');
  return {
    ...actual,
    callAgent: vi.fn(),
    callAgentForFindings: vi.fn(),
    initClient: vi.fn(),
    withTimeout: vi.fn(async <T>(promise: Promise<T>) => promise),
  };
});

import { runDebate } from '../debate.js';
import { callAgent } from '../agents/base.js';

const mockCallAgent = vi.mocked(callAgent);

function finding(id: string, severity: Finding['severity'] = 'High'): Finding {
  return {
    id,
    agent: 'security',
    severity,
    title: `Finding ${id}`,
    description: 'desc',
    excerpt: 'some text',
    recommendation: 'fix',
  };
}

const CONFIG = {
  specialistModel: 'spec-model',
  judgeModel: 'judge-model',
  skepticModel: 'skeptic-model',
  dedupModel: 'dedup-model',
  maxDebateRounds: 1,
  apiKey: 'test',
};

describe('runDebate', () => {
  beforeEach(() => mockCallAgent.mockReset());

  it('keeps Low findings unchallenged (they are not challengeable)', async () => {
    // Low findings are not sent to skeptic — so callAgent is called 0 times
    const lowFinding = finding('low1', 'Low');
    const result = await runDebate([lowFinding], CONFIG);
    expect(result.survivingFindings).toContain(lowFinding);
    expect(mockCallAgent).not.toHaveBeenCalled();
  });

  it('eliminates findings rated unconvincing by the skeptic', async () => {
    const f = finding('h1', 'High');
    // Round: skeptic challenges → rebuttal → skeptic rates unconvincing
    mockCallAgent
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h1', challenge: 'Weak evidence.' }])) // challenge
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h1', agent: 'security', defense: 'My defense.' }])) // rebuttal
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h1', rating: 'unconvincing', confidence: 90, reasoning: 'Not convincing.' }])); // rating

    const result = await runDebate([f], CONFIG);
    expect(result.survivingFindings).toHaveLength(0);
  });

  it('keeps findings rated convincing by the skeptic', async () => {
    const f = finding('h2', 'High');
    mockCallAgent
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h2', challenge: 'Is this real?' }]))
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h2', agent: 'security', defense: 'Strong defense.' }]))
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h2', rating: 'convincing', confidence: 85, reasoning: 'Well defended.' }]));

    const result = await runDebate([f], CONFIG);
    expect(result.survivingFindings).toHaveLength(1);
    expect(result.survivingFindings[0].id).toBe('h2');
  });

  it('keeps unchallenged High/Critical findings when skeptic returns empty challenges', async () => {
    const f = finding('h3', 'Critical');
    mockCallAgent.mockResolvedValueOnce('[]'); // no challenges

    const result = await runDebate([f], CONFIG);
    // Not challenged → not in challengedIds → survives
    expect(result.survivingFindings).toContain(f);
  });

  it('records rounds in debateState', async () => {
    const f = finding('h4', 'Medium');
    mockCallAgent
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h4', challenge: 'Challenge.' }]))
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h4', agent: 'security', defense: 'Defense.' }]))
      .mockResolvedValueOnce(JSON.stringify([{ findingId: 'h4', rating: 'convincing', confidence: 75, reasoning: 'ok' }]));

    const result = await runDebate([f], CONFIG);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].round).toBe(1);
    expect(result.rounds[0].challenges).toHaveLength(1);
    expect(result.rounds[0].rebuttals).toHaveLength(1);
    expect(result.rounds[0].ratings).toHaveLength(1);
  });
});
