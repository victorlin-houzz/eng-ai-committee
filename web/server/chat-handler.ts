import type { Socket } from 'socket.io';
import { timingSafeEqual } from 'node:crypto';
import OpenAI from 'openai';
import type { PipelineResult } from '../../src/pipeline/orchestrator.js';
import { logEvent, getRunMetadata } from './history-store.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const JUDGE_MODEL = process.env.CHAT_MODEL ?? 'gpt-4o';

function hasValidAccessToken(runId: string, accessToken?: string): boolean {
  if (!accessToken) return false;
  const meta = getRunMetadata(runId);
  if (!meta?.accessToken) return false;
  const expected = Buffer.from(meta.accessToken);
  const actual = Buffer.from(accessToken);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isSafeRunId(runId: unknown): runId is string {
  return typeof runId === 'string' && runId.length > 0 && runId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(runId);
}

/** Max doc chars sent as context to keep tokens reasonable */
const MAX_CTX_CHARS = 40_000;

function buildSystemPrompt(result: PipelineResult, docText: string): string {
  const { verdict, confidence, topBlockingIssues, revisionMemo, committeeBrief } = result.verdict;

  const issues = topBlockingIssues
    .map((f) => `- [${f.severity}] ${f.title}: ${f.description}`)
    .join('\n');

  const truncatedDoc = docText.length > MAX_CTX_CHARS
    ? docText.slice(0, MAX_CTX_CHARS) + '\n\n[... document truncated ...]'
    : docText;

  return `You are the Judge from an engineering committee AI review system.

REVIEW OUTCOME:
- Verdict: ${verdict} (confidence: ${confidence}%)
- Top blocking issues:\n${issues || '  None'}
${revisionMemo ? `- Revision memo:\n${revisionMemo}` : ''}
${committeeBrief ? `- Committee brief:\n${committeeBrief}` : ''}

CURRENT DESIGN DOCUMENT:
${truncatedDoc}

Your role: Help the author improve their design document based on the review findings.
- Answer questions about why certain issues were flagged
- Suggest specific improvements, text additions, or restructuring
- When providing text to add/replace in the document, wrap it in a JSON block on its own line:
  {"insert": "the text to add", "section": "Section Name or heading where it should go"}
- Be specific and reference the actual document content`;
}

export function registerChatHandler(
  socket: Socket,
  sessionResults: Map<string, { result: PipelineResult; docText: string }>,
): void {
  socket.on('chat:message', async ({ runId, message, history, accessToken, saveLog = true }: {
    runId: string;
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    accessToken?: string;
    saveLog?: boolean;
  }) => {
    if (!isSafeRunId(runId) || !hasValidAccessToken(runId, accessToken)) {
      socket.emit('chat:error', { error: 'Forbidden' });
      return;
    }
    if (typeof message !== 'string' || !Array.isArray(history)) {
      socket.emit('chat:error', { error: 'Invalid request' });
      return;
    }
    const session = sessionResults.get(runId);
    if (!session) {
      socket.emit('chat:error', { error: 'Session not found. Please run a review first.' });
      return;
    }

    const systemPrompt = buildSystemPrompt(session.result, session.docText);

    // Log user message
    logEvent(runId, 'chat_user', { message });

    let assistantFull = '';
    try {
      const stream = client.responses.stream({
        model: JUDGE_MODEL,
        input: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: message },
        ],
        instructions: systemPrompt,
      });

      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          socket.emit('chat:token', { delta: event.delta });
          assistantFull += event.delta;
        }
      }

      // Log assistant response
      logEvent(runId, 'chat_assistant', { message: assistantFull });
      socket.emit('chat:done');
    } catch (err) {
      socket.emit('chat:error', { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
