import { io, Socket } from 'socket.io-client';
import type { PipelineEvent } from '../../src/pipeline/events.js';
import { getRunAccessToken } from './run-access.js';

export type { PipelineEvent };

export interface SocketClient {
  socket: Socket;
  startReview(opts: { runId: string; docText: string; filename: string; agents: string; depth: number }): void;
  cancelReview(runId: string): void;
  saveToArchive(opts: { runId: string; editedDocText: string; filename: string }): void;
  sendChatMessage(opts: { runId: string; message: string; history: Array<{ role: 'user' | 'assistant'; content: string }> }): void;
  rejoinRun(runId: string, accessToken: string): void;
  on<K extends keyof ClientEvents>(event: K, handler: ClientEvents[K]): void;
  off<K extends keyof ClientEvents>(event: K, handler: ClientEvents[K]): void;
}

export interface ClientEvents {
  'pipeline:session':       (data: { runId: string; accessToken: string }) => void;
  'pipeline:event':         (event: PipelineEvent) => void;
  'pipeline:progress':      (data: { message: string }) => void;
  'pipeline:cancelled':     (data: { runId: string }) => void;
  'pipeline:rejoin:status': (data: { status: 'running' | 'complete' | 'unknown' | 'restarting' | 'unauthorized'; result?: import('../../src/pipeline/orchestrator.js').PipelineResult; pastEvents?: PipelineEvent[] }) => void;
  'chat:token':             (data: { delta: string }) => void;
  'chat:done':              () => void;
  'chat:error':             (data: { error: string }) => void;
  'archive:saved':          (data: { runId: string }) => void;
  'archive:error':          (data: { error: string }) => void;
}

export function createSocketClient(): SocketClient {
  const socket = io({ transports: ['websocket', 'polling'] });

  return {
    socket,
    startReview(opts) { socket.emit('pipeline:run', opts); },
    cancelReview(runId) {
      socket.emit('pipeline:cancel', { runId, accessToken: getRunAccessToken(runId) });
    },
    saveToArchive(opts) {
      socket.emit('archive:save', { ...opts, accessToken: getRunAccessToken(opts.runId) });
    },
    sendChatMessage(opts) {
      socket.emit('chat:message', { ...opts, accessToken: getRunAccessToken(opts.runId) });
    },
    rejoinRun(runId, accessToken) { socket.emit('pipeline:rejoin', { runId, accessToken }); },
    on(event, handler) { socket.on(event as string, handler as any); },
    off(event, handler) { socket.off(event as string, handler as any); },
  };
}
