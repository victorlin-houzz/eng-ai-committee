import { beforeEach, describe, expect, it, vi } from 'vitest';

const responsesCreate = vi.fn();
const chatCompletionsCreate = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: responsesCreate,
    };

    chat = {
      completions: {
        create: chatCompletionsCreate,
      },
    };
  }

  return {
    default: MockOpenAI,
  };
});

import { callAgent, callAgentForFindings, initClient } from '../agents/base.js';

describe('callAgent', () => {
  beforeEach(() => {
    responsesCreate.mockReset();
    chatCompletionsCreate.mockReset();
    initClient('test-key');
  });

  it('routes gpt-5 models through the Responses API', async () => {
    responsesCreate.mockResolvedValueOnce({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'response text' }],
        },
      ],
    });

    const result = await callAgent('system', 'user', 'gpt-5.4-pro', 'high');

    expect(result).toBe('response text');
    expect(responsesCreate).toHaveBeenCalledWith(
      {
        model: 'gpt-5.4-pro',
        instructions: 'system',
        input: 'user',
        max_output_tokens: 32768,
        reasoning: { effort: 'high' },
      },
      { signal: undefined },
    );
    expect(chatCompletionsCreate).not.toHaveBeenCalled();
  });

  it('reads top-level output_text from Responses API payloads', async () => {
    responsesCreate.mockResolvedValueOnce({
      output_text: 'top-level response text',
      output: [],
    });

    const result = await callAgent('system', 'user', 'gpt-5.4-pro', 'high');

    expect(result).toBe('top-level response text');
  });

  it('routes non-gpt-5 models through Chat Completions', async () => {
    chatCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'chat text' } }],
    });

    const result = await callAgent('system', 'user', 'gpt-4.1', 'medium');

    expect(result).toBe('chat text');
    expect(chatCompletionsCreate).toHaveBeenCalledWith(
      {
        model: 'gpt-4.1',
        messages: [
          { role: 'system', content: 'system' },
          { role: 'user', content: 'user' },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      },
      { signal: undefined },
    );
    expect(responsesCreate).not.toHaveBeenCalled();
  });
});

describe('callAgentForFindings', () => {
  beforeEach(() => {
    responsesCreate.mockReset();
    chatCompletionsCreate.mockReset();
    initClient('test-key');
  });

  it('requests structured JSON for gpt-5 findings', async () => {
    const findings = [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        agent: 'architecture',
        severity: 'High',
        title: 'Missing failover',
        description: 'No failover plan is defined.',
        excerpt: 'The system uses a single primary database.',
        recommendation: 'Define failover and replica strategy.',
      },
    ];

    responsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ findings }),
      output: [],
    });

    const result = await callAgentForFindings(
      'system',
      'user',
      'gpt-5.4',
      'The system uses a single primary database.',
      'high',
    );

    expect(result).toEqual(findings);
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4',
        instructions: 'system',
        input: 'user',
        text: {
          format: expect.objectContaining({
            type: 'json_schema',
            name: 'findings',
            strict: true,
          }),
        },
      }),
      { signal: undefined },
    );
  });

  it('extracts the first JSON array from non-gpt-5 text responses', async () => {
    chatCompletionsCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                'Here are the findings:\n```json\n[{"id":"1","agent":"security","severity":"Medium","title":"Test","description":"desc","excerpt":"quoted text","recommendation":"fix"}]\n```',
            },
          },
        ],
      });

    const result = await callAgentForFindings('system', 'user', 'gpt-4.1', 'quoted text', 'medium');

    expect(result).toEqual([
      {
        id: '1',
        agent: 'security',
        severity: 'Medium',
        title: 'Test',
        description: 'desc',
        excerpt: 'quoted text',
        recommendation: 'fix',
      },
    ]);
  });
});
