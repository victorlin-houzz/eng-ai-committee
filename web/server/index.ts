import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIO } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { setupSocketHandlers } from './socket-handler.js';
import { createUploadRouter } from './upload-handler.js';
import { createExportRouter } from './export-handler.js';
import { initDb, listReviews, getReview, getImages, getConversationLog, getRunMetadata } from './history-store.js';
import { initClient } from '../../src/pipeline/agents/base.js';
import { loadConfig } from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const CLIENT_DIST = join(process.cwd(), 'dist', 'client');

// ── CORS allowlist ─────────────────────────────────────────────────────
// Origins allowed to open cross-origin Socket.IO / fetch connections.
// Defaults cover local dev. For production, set ALLOWED_ORIGINS as a
// comma-separated list (e.g. "https://review.example.com").
// NEVER use "*" — any site a user visits could then hijack their session
// and trigger expensive LLM pipelines.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
  if (!meta?.accessToken) return false;
  // Constant-time comparison to avoid token leakage via timing side-channel.
  const expected = Buffer.from(meta.accessToken);
  const actual = Buffer.from(accessToken);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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

// History endpoints.
// Listing is intentionally local-only — the SQLite DB is single-tenant and
// the list itself (filenames + verdicts) is treated as sensitive. To expose
// it beyond localhost, front this service with your own auth layer.
function isLocalRequest(req: express.Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

app.get('/api/history', (req, res) => {
  if (process.env.HISTORY_PUBLIC !== '1' && !isLocalRequest(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
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
  cors: {
    origin: (origin, cb) => {
      // Same-origin requests have no Origin header — allow them.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin not allowed: ${origin}`), false);
    },
    credentials: true,
  },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for doc uploads over socket
});

setupSocketHandlers(io);

// ── Start ──────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[server] eng-ai-committee running at http://localhost:${PORT}`);
});
