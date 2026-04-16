import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Finding } from '../../types.js';

vi.mock('../agents/base.js', () => ({
  callAgent: vi.fn(),
  callAgentForFindings: vi.fn(),
  initClient: vi.fn(),
}));

import { runDeduplication } from '../deduplication.js';
import { callAgent } from '../agents/base.js';

const mockCallAgent = vi.mocked(callAgent);

function finding(id: string): Finding {
  return {
    id,
    agent: 'security',
    severity: 'Medium',
    title: `Finding ${id}`,
    description: 'desc',
    excerpt: 'text',
    recommendation: 'fix',
  };
}

describe('runDeduplication', () => {
  beforeEach(() => mockCallAgent.mockReset());

  it('returns empty array without calling LLM for empty input', async () => {
    const result = await runDeduplication([], 'model');
    expect(result).toEqual([]);
    expect(mockCallAgent).not.toHaveBeenCalled();
  });

  it('returns deduplicated findings from LLM response', async () => {
    const deduped = [finding('a')];
    mockCallAgent.mockResolvedValueOnce(JSON.stringify(deduped));
    const result = await runDeduplication([finding('a'), finding('b')], 'model');
    expect(result).toEqual(deduped);
  });

  it('returns original findings when LLM returns no JSON array', async () => {
    const original = [finding('a'), finding('b')];
    mockCallAgent.mockResolvedValueOnce('No duplicates found.');
    const result = await runDeduplication(original, 'model');
    expect(result).toEqual(original);
  });

  it('returns original findings when LLM JSON is malformed', async () => {
    const original = [finding('x')];
    mockCallAgent.mockResolvedValueOnce('[{ broken }]');
    const result = await runDeduplication(original, 'model');
    expect(result).toEqual(original);
  });

  it('passes model through to callAgent', async () => {
    mockCallAgent.mockResolvedValueOnce(JSON.stringify([finding('a')]));
    await runDeduplication([finding('a')], 'gpt-4o-mini');
    const [, , model] = mockCallAgent.mock.calls[0];
    expect(model).toBe('gpt-4o-mini');
  });
});
