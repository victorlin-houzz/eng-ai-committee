import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../agents/base.js', () => ({
  callAgent: vi.fn(),
  callAgentForFindings: vi.fn(),
  initClient: vi.fn(),
}));

import { runStructuralCheck } from '../structural-check.js';
import { callAgent } from '../agents/base.js';

const mockCallAgent = vi.mocked(callAgent);

describe('runStructuralCheck', () => {
  beforeEach(() => mockCallAgent.mockReset());

  it('returns pass:true when all sections are present', async () => {
    mockCallAgent.mockResolvedValueOnce(JSON.stringify({ pass: true, missingSections: [] }));
    const result = await runStructuralCheck('some doc text', 'model');
    expect(result.pass).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  it('returns pass:false with missing sections listed', async () => {
    mockCallAgent.mockResolvedValueOnce(
      JSON.stringify({ pass: false, missingSections: ['problem statement', 'success criteria'] }),
    );
    const result = await runStructuralCheck('some doc text', 'model');
    expect(result.pass).toBe(false);
    expect(result.missingSections).toEqual(['problem statement', 'success criteria']);
  });

  it('falls back to pass:true when LLM returns no JSON', async () => {
    mockCallAgent.mockResolvedValueOnce('I cannot determine this.');
    const result = await runStructuralCheck('some doc text', 'model');
    expect(result.pass).toBe(true);
    expect(result.missingSections).toEqual([]);
  });

  it('falls back to pass:true when JSON is malformed', async () => {
    mockCallAgent.mockResolvedValueOnce('{ broken json }');
    const result = await runStructuralCheck('some doc text', 'model');
    expect(result.pass).toBe(true);
  });

  it('passes docText and model through to callAgent', async () => {
    mockCallAgent.mockResolvedValueOnce(JSON.stringify({ pass: true, missingSections: [] }));
    await runStructuralCheck('my document', 'gpt-4o');
    expect(mockCallAgent).toHaveBeenCalledOnce();
    const [, userPrompt, model] = mockCallAgent.mock.calls[0];
    expect(userPrompt).toContain('my document');
    expect(model).toBe('gpt-4o');
  });
});
