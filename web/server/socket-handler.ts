import type { Server as SocketServer, Socket } from 'socket.io';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPipeline } from '../../src/pipeline/orchestrator.js';
import { loadConfig } from '../../src/config.js';
import { saveReview, saveImages, logEvent, getConversationLog, saveRunMetadata, getRunMetadata } from './history-store.js';
import { sessionImages } from './upload-handler.js';
import { registerChatHandler } from './chat-handler.js';
import type { PipelineResult } from '../../src/pipeline/orchestrator.js';

/** Active pipeline runs: runId → AbortController */
const activeRuns = new Map<string, AbortController>();

/** Completed session results for chat context: runId → { result, docText } */
const sessionResults = new Map<string, { result: PipelineResult; docText: string }>();

function hasValidAccessToken(runId: string, accessToken?: string): boolean {
  if (!accessToken) return false;
  const meta = getRunMetadata(runId);
  if (!meta?.accessToken) return false;
  const expected = Buffer.from(meta.accessToken);
  const actual = Buffer.from(accessToken);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function setupSocketHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── Start pipeline ──────────────────────────────────────────────────
    socket.on('pipeline:run', async ({
      runId,
      docText,
      filename,
      agents = 'all',
      depth = 1,
    }: {
      runId: string;
      docText: string;
      filename: string;
      agents?: string;
      depth?: number;
    }) => {
      const controller = new AbortController();
      activeRuns.set(runId, controller);
      const accessToken = randomBytes(32).toString('hex');

      // Join a room for this runId so any reconnecting socket can receive events
      socket.join(`run:${runId}`);

      // Persist doc text so we can auto-resume if the server restarts mid-pipeline
      saveRunMetadata(runId, filename, docText, agents, depth, accessToken);
      socket.emit('pipeline:session', { runId, accessToken });

      const config = {
        ...loadConfig(),
        maxDebateRounds: Math.min(Math.max(depth, 1), 2),
      };

      const tmpPath = join(tmpdir(), `review-${runId}.txt`);

      try {
        const imgs = (sessionImages.get(runId) ?? []).map(({ mimeType, dataB64 }) => ({ mimeType, dataB64 }));
        const result = await runPipeline(
          docText,
          config,
          agents,
          tmpPath,
          (msg) => {
            io.to(`run:${runId}`).emit('pipeline:progress', { message: msg });
            logEvent(runId, 'progress', { message: msg });
          },
          (event) => {
            io.to(`run:${runId}`).emit('pipeline:event', event);
            logEvent(runId, 'pipeline_event', event);
          },
          imgs,
        );

        // Store for chat context
        sessionResults.set(runId, { result, docText });
        // Expire after 4 hours
        setTimeout(() => sessionResults.delete(runId), 4 * 60 * 60 * 1000);
      } catch (err) {
        io.to(`run:${runId}`).emit('pipeline:event', {
          type: 'pipeline:error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        activeRuns.delete(runId);
      }
    });

    // ── Rejoin an in-progress or completed run ──────────────────────────
    socket.on('pipeline:rejoin', ({ runId, accessToken }: { runId: string; accessToken?: string }) => {
      if (!hasValidAccessToken(runId, accessToken)) {
        socket.emit('pipeline:rejoin:status', { status: 'unauthorized', pastEvents: [] });
        return;
      }

      // Always replay logged events so the client can reconstruct agent states
      const log = getConversationLog(runId);
      const pastEvents = log
        .filter((e) => e.kind === 'pipeline_event')
        .map((e) => { try { return JSON.parse(e.payload); } catch { return null; } })
        .filter(Boolean);

      if (activeRuns.has(runId)) {
        // Still running — join the room so future events arrive, then replay past ones
        socket.join(`run:${runId}`);
        socket.emit('pipeline:rejoin:status', { status: 'running', pastEvents });
      } else if (sessionResults.has(runId)) {
        // Completed this server session — send result + past events
        const { result } = sessionResults.get(runId)!;
        socket.emit('pipeline:rejoin:status', { status: 'complete', result, pastEvents });
      } else {
        // Server restarted — check if DB log has a completion event
        const completeEntry = pastEvents.find((e: any) => e.type === 'pipeline:complete');
        if (completeEntry) {
          socket.emit('pipeline:rejoin:status', { status: 'complete', result: completeEntry.result, pastEvents });
        } else {
          // Pipeline was incomplete — try to auto-resume using stored doc text
          const meta = getRunMetadata(runId);
          if (meta) {
            socket.join(`run:${runId}`);
            socket.emit('pipeline:rejoin:status', { status: 'restarting', pastEvents: [] });

            const resumeController = new AbortController();
            activeRuns.set(runId, resumeController);
            const resumeConfig = {
              ...loadConfig(),
              maxDebateRounds: Math.min(Math.max(meta.depth, 1), 2),
            };
            const resumeTmpPath = join(tmpdir(), `review-${runId}.txt`);

            const resumeImgs = (sessionImages.get(runId) ?? []).map(({ mimeType, dataB64 }) => ({ mimeType, dataB64 }));
            runPipeline(
              meta.docText,
              resumeConfig,
              meta.agents,
              resumeTmpPath,
              (msg) => {
                io.to(`run:${runId}`).emit('pipeline:progress', { message: msg });
                logEvent(runId, 'progress', { message: msg });
              },
              (event) => {
                io.to(`run:${runId}`).emit('pipeline:event', event);
                logEvent(runId, 'pipeline_event', event);
              },
              resumeImgs,
            ).then((result) => {
              sessionResults.set(runId, { result, docText: meta.docText });
              setTimeout(() => sessionResults.delete(runId), 4 * 60 * 60 * 1000);
            }).catch((err) => {
              io.to(`run:${runId}`).emit('pipeline:event', {
                type: 'pipeline:error',
                message: err instanceof Error ? err.message : String(err),
              });
            }).finally(() => {
              activeRuns.delete(runId);
            });
          } else {
            socket.emit('pipeline:rejoin:status', { status: 'unknown', pastEvents });
          }
        }
      }
    });

    // ── Save to archive ─────────────────────────────────────────────────
    socket.on('archive:save', async ({
      runId,
      editedDocText,
      filename,
    }: {
      runId: string;
      editedDocText: string;
      filename: string;
    }) => {
      const session = sessionResults.get(runId);
      if (!session) {
        socket.emit('archive:error', { error: 'No completed review found for this run' });
        return;
      }
      try {
        saveReview(runId, filename, session.result, editedDocText);
        // Persist images from session to DB
        const imgs = sessionImages.get(runId) ?? [];
        if (imgs.length > 0) {
          saveImages(runId, imgs.map(({ index, mimeType, dataB64 }) => ({
            imgIndex: index,
            mimeType,
            dataB64,
          })));
        }
        socket.emit('archive:saved', { runId });
      } catch (err) {
        socket.emit('archive:error', { error: err instanceof Error ? err.message : String(err) });
      }
    });

    // ── Cancel pipeline ─────────────────────────────────────────────────
    socket.on('pipeline:cancel', ({ runId }: { runId: string }) => {
      const ctrl = activeRuns.get(runId);
      if (ctrl) {
        ctrl.abort();
        activeRuns.delete(runId);
        socket.emit('pipeline:cancelled', { runId });
      }
    });

    // ── Chat with judge ─────────────────────────────────────────────────
    registerChatHandler(socket, sessionResults);

    // ── Disconnect: abort any running pipeline for this socket ──────────
    socket.on('disconnect', () => {
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });
}
