import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIO } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { setupSocketHandlers } from './socket-handler.js';
import { createUploadRouter } from './upload-handler.js';
import { createExportRouter } from './export-handler.js';
import { initDb, listReviews, getReview, getImages, getConversationLog, getRunMetadata } from './history-store.js';
import { initClient } from '../../src/pipeline/agents/base.js';
import { loadConfig } from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const CLIENT_DIST = join(process.cwd(), 'dist', 'client');

// ── Init DB ────────────────────────────────────────────────────────────
initDb();

// ── Init OpenAI client ─────────────────────────────────────────────────
const cfg = loadConfig();
initClient(cfg.apiKey);

// ── Express app ────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve built Vite frontend
app.use(express.static(CLIENT_DIST));

// ── REST routes ────────────────────────────────────────────────────────
app.use('/api', createUploadRouter());
app.use('/api', createExportRouter());

function hasValidAccessToken(runId: string, accessToken?: string): boolean {
  if (!accessToken) return false;
  const meta = getRunMetadata(runId);
  return Boolean(meta?.accessToken && meta.accessToken === accessToken);
}

function requireRunAccess(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const { runId } = req.params;
  const accessToken = typeof req.query.accessToken === 'string'
    ? req.query.accessToken
    : typeof req.headers['x-run-access-token'] === 'string'
      ? req.headers['x-run-access-token']
      : undefined;
  if (!hasValidAccessToken(runId, accessToken)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

// History endpoints
app.get('/api/history', (_req, res) => {
  res.json(listReviews(50));
});

app.get('/api/history/:runId', requireRunAccess, (req, res) => {
  const detail = getReview(req.params.runId);
  if (!detail) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(detail);
});

app.get('/api/history/:runId/images', requireRunAccess, (req, res) => {
  const imgs = getImages(req.params.runId);
  res.json(imgs.map(({ imgIndex, mimeType, dataB64 }) => ({
    index: imgIndex,
    mimeType,
    dataUrl: `data:${mimeType};base64,${dataB64}`,
  })));
});

app.get('/api/history/:runId/log', requireRunAccess, (req, res) => {
  const log = getConversationLog(req.params.runId);
  res.json(log);
});

// Health check for K8s readiness probe
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// SPA fallback — serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(join(CLIENT_DIST, 'index.html'));
});

// ── Socket.IO ──────────────────────────────────────────────────────────
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for doc uploads over socket
});

setupSocketHandlers(io);

// ── Start ──────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[server] eng-ai-committee running at http://localhost:${PORT}`);
});
