import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import type { ResponseOutputMessage, ResponseOutputText, EasyInputMessage, ResponseInputText, ResponseInputImage } from 'openai/resources/responses/responses.js';
import type { Finding } from '../../types.js';

/** Image (rendered PDF page or embedded DOCX image) passed to specialist agents. */
export interface AgentImage {
  mimeType: string;
  dataB64: string;
}

let _client: OpenAI | null = null;

/** Call once at startup before any agent calls. */
export function initClient(apiKey: string): void {
  _client = new OpenAI({ apiKey });
}

function getClient(): OpenAI {
  if (!_client) throw new Error('OpenAI client not initialized. Call initClient() first.');
  return _client;
}

/**
 * Reasoning effort hint passed to callAgent for models that support it.
 * gpt-5.x family and o-series models accept reasoning effort.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

// OpenAI json_schema format requires the root to be type:"object".
// Wrap the findings array in a container object and unwrap after parsing.
const FINDINGS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'agent', 'severity', 'title', 'description', 'excerpt', 'recommendation'],
        properties: {
          id: { type: 'string' },
          agent: { type: 'string' },
          severity: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
          title: { type: 'string' },
          description: { type: 'string' },
          excerpt: { type: 'string' },
          recommendation: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Wrap a promise with a hard timeout. Rejects with an Error on expiry. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function extractTextFromResponsesOutput(response: { output_text?: string; output?: unknown[] }): string {
  if (typeof response.output_text === 'string' && response.output_text.trim() !== '') {
    return response.output_text;
  }

  const message = response.output?.find((item): item is ResponseOutputMessage => {
    return typeof item === 'object' && item !== null && (item as ResponseOutputMessage).type === 'message';
  });
  const textPart = message?.content.find((c): c is ResponseOutputText => c.type === 'output_text');
  return textPart?.text ?? '';
}

function extractFirstJsonArray(raw: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (start === -1) {
      if (ch === '[') {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return null;
}

function buildMultimodalInput(userPrompt: string, images: AgentImage[]): string | EasyInputMessage[] {
  if (images.length === 0) return userPrompt;
  const content: Array<ResponseInputText | ResponseInputImage> = [
    { type: 'input_text', text: userPrompt },
    ...images.map((img): ResponseInputImage => ({
      type: 'input_image',
      image_url: `data:${img.mimeType};base64,${img.dataB64}`,
      detail: 'auto',
    })),
  ];
  return [{ role: 'user', content }];
}

async function callGpt5ForFindings(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  reasoningEffort: ReasoningEffort,
  images: AgentImage[],
  signal?: AbortSignal,
): Promise<Finding[]> {
  const response = await getClient().responses.create(
    {
      model,
      instructions: systemPrompt,
      input: buildMultimodalInput(userPrompt, images),
      max_output_tokens: 32768,
      reasoning: { effort: reasoningEffort },
      text: {
        format: {
          type: 'json_schema',
          name: 'findings',
          strict: true,
          schema: FINDINGS_JSON_SCHEMA,
        },
      },
    },
    { signal },
  );

  const content = extractTextFromResponsesOutput(response);
  if (!content) throw new Error('No content in OpenAI Responses API response');

  const parsed = JSON.parse(content) as { findings: Finding[] };
  return parsed.findings ?? [];
}

/**
 * Call an OpenAI model with a system + user prompt. Returns the raw text response.
 *
 * gpt-5.x models use the Responses API (/v1/responses).
 * o-series and older gpt-4 models use Chat Completions (/v1/chat/completions).
 */
export async function callAgent(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  reasoningEffort: ReasoningEffort = 'medium',
  signal?: AbortSignal,
): Promise<string> {
  if (/^gpt-5/.test(model)) {
    // gpt-5.x models only support the Responses API, not chat completions
    const response = await getClient().responses.create(
      {
        model,
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: 32768,
        reasoning: { effort: reasoningEffort },
      },
      { signal },
    );

    const content = extractTextFromResponsesOutput(response);
    if (!content) throw new Error('No content in OpenAI Responses API response');
    return content;
  }

  // o1/o3/o4 and gpt-4 family: use Chat Completions
  const isReasoningModel = /^(o1|o3|o4)/.test(model);
  const params: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...(isReasoningModel
      ? { max_completion_tokens: 8192, reasoning_effort: reasoningEffort }
      : { max_tokens: 4096, temperature: 0.3 }),
  };
  const response = await getClient().chat.completions.create(params, { signal });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');
  return content;
}

/**
 * Call an OpenAI model expecting a JSON array of Finding objects.
 * Retries once on parse failure. Discards findings with empty or absent excerpts.
 * Pass `images` to enable multimodal review (e.g. PDF page renders).
 */
export async function callAgentForFindings(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  docText: string,
  reasoningEffort: ReasoningEffort = 'medium',
  images: AgentImage[] = [],
  signal?: AbortSignal,
): Promise<Finding[]> {
  async function attempt(prompt: string): Promise<Finding[]> {
    if (/^gpt-5/.test(model)) {
      return callGpt5ForFindings(systemPrompt, prompt, model, reasoningEffort, images, signal);
    }

    const raw = await callAgent(systemPrompt, prompt, model, reasoningEffort, signal);

    // If the signal fired during the API call, the response may be truncated or empty.
    // Surface a clear timeout error rather than a misleading parse-failure message.
    if (signal?.aborted) throw new Error('Agent timed out — response may be incomplete');

    const jsonArray = extractFirstJsonArray(raw);
    if (!jsonArray) {
      const preview = raw.slice(0, 120).replace(/\n/g, ' ').trim();
      throw new Error(`Response was not a JSON array — received: "${preview}"`);
    }
    return JSON.parse(jsonArray) as Finding[];
  }

  let findings: Finding[];
  try {
    findings = await attempt(userPrompt);
  } catch (err) {
    // Do not retry on abort/timeout — the orchestrator will retry with a fresh
    // AbortController if SPECIALIST_MAX_ATTEMPTS allows.
    if (signal?.aborted) throw err;
    findings = await attempt(
      userPrompt + '\n\nIMPORTANT: Your output must be a valid JSON array and nothing else.',
    );
  }

  // Hallucination guard: discard findings where excerpt is empty or not verbatim in the doc
  return findings.filter((f) => {
    if (!f.excerpt || f.excerpt.trim() === '') return false;
    return docText.includes(f.excerpt.trim());
  });
}
