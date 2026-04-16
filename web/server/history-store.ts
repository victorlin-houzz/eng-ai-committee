import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PipelineResult } from '../../src/pipeline/orchestrator.js';
import type { PipelineEvent } from '../../src/pipeline/events.js';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'reviews.db');

let db: DatabaseSync;

export interface HistorySummary {
  runId: string;
  filename: string;
  verdict: string;
  confidence: number;
  createdAt: number;
}

export interface HistoryDetail extends HistorySummary {
  editedDoc: string;
  resultJson: PipelineResult;
}

export interface StoredImage {
  imgIndex: number;
  mimeType: string;
  dataB64: string;
}

export interface ConversationEntry {
  id: number;
  runId: string;
  ts: number;
  kind: 'pipeline_event' | 'chat_user' | 'chat_assistant' | 'progress';
  payload: string; // JSON string of the event/message
}

export interface RunMetadata {
  runId: string;
  filename: string;
  docText: string;
  agents: string;
  depth: number;
  accessToken: string;
  createdAt: number;
}

export function initDb(): void {
  try {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        run_id      TEXT PRIMARY KEY,
        filename    TEXT NOT NULL DEFAULT '',
        verdict     TEXT NOT NULL DEFAULT '',
        confidence  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL DEFAULT 0,
        edited_doc  TEXT NOT NULL DEFAULT '',
        result_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS review_images (
        run_id     TEXT NOT NULL,
        img_index  INTEGER NOT NULL,
        mime_type  TEXT NOT NULL DEFAULT 'image/png',
        data_b64   TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (run_id, img_index)
      );
      CREATE TABLE IF NOT EXISTS conversation_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id     TEXT NOT NULL,
        ts         INTEGER NOT NULL,
        kind       TEXT NOT NULL,
        payload    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conv_run ON conversation_log(run_id, id);
      CREATE TABLE IF NOT EXISTS run_metadata (
        run_id      TEXT PRIMARY KEY,
        filename    TEXT NOT NULL DEFAULT '',
        doc_text    TEXT NOT NULL DEFAULT '',
        agents      TEXT NOT NULL DEFAULT 'all',
        depth       INTEGER NOT NULL DEFAULT 1,
        access_token TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL DEFAULT 0
      );
    `);
    try {
      db.exec(`ALTER TABLE run_metadata ADD COLUMN access_token TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists in upgraded DBs.
    }
    console.log(`[db] SQLite ready at ${DB_PATH}`);
  } catch (err) {
    console.warn(`[db] SQLite unavailable (${err instanceof Error ? err.message : err}). Running with in-memory fallback — history will not persist.`);
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (run_id TEXT PRIMARY KEY, filename TEXT DEFAULT '', verdict TEXT DEFAULT '', confidence INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0, edited_doc TEXT DEFAULT '', result_json TEXT DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS review_images (run_id TEXT, img_index INTEGER, mime_type TEXT DEFAULT 'image/png', data_b64 TEXT DEFAULT '', PRIMARY KEY (run_id, img_index));
      CREATE TABLE IF NOT EXISTS conversation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, ts INTEGER, kind TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS run_metadata (run_id TEXT PRIMARY KEY, filename TEXT DEFAULT '', doc_text TEXT DEFAULT '', agents TEXT DEFAULT 'all', depth INTEGER DEFAULT 1, access_token TEXT DEFAULT '', created_at INTEGER DEFAULT 0);
    `);
  }
}

export function saveReview(
  runId: string,
  filename: string,
  result: PipelineResult,
  editedDoc: string,
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO reviews (run_id, filename, verdict, confidence, created_at, edited_doc, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    runId,
    filename,
    result.verdict.verdict,
    result.verdict.confidence,
    Date.now(),
    editedDoc,
    JSON.stringify(result),
  );
}

export function saveImages(runId: string, images: StoredImage[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO review_images (run_id, img_index, mime_type, data_b64)
    VALUES (?, ?, ?, ?)
  `);
  for (const img of images) {
    stmt.run(runId, img.imgIndex, img.mimeType, img.dataB64);
  }
}

export function logEvent(runId: string, kind: ConversationEntry['kind'], payload: object): void {
  try {
    db.prepare(`INSERT INTO conversation_log (run_id, ts, kind, payload) VALUES (?, ?, ?, ?)`)
      .run(runId, Date.now(), kind, JSON.stringify(payload));
  } catch { /* Non-critical — never let logging crash the pipeline */ }
}

export function getConversationLog(runId: string): ConversationEntry[] {
  const stmt = db.prepare(`SELECT id, run_id, ts, kind, payload FROM conversation_log WHERE run_id = ? ORDER BY id ASC`);
  return (stmt.all(runId) as any[]).map((r) => ({
    id: r.id,
    runId: r.run_id,
    ts: r.ts,
    kind: r.kind,
    payload: r.payload,
  }));
}

export function listReviews(limit = 50): HistorySummary[] {
  const stmt = db.prepare(`
    SELECT run_id, filename, verdict, confidence, created_at
    FROM reviews ORDER BY created_at DESC LIMIT ?
  `);
  const rows = stmt.all(limit) as any[];
  return rows.map((r) => ({
    runId: r.run_id,
    filename: r.filename,
    verdict: r.verdict,
    confidence: r.confidence,
    createdAt: r.created_at,
  }));
}

export function getReview(runId: string): HistoryDetail | null {
  const stmt = db.prepare(`SELECT * FROM reviews WHERE run_id = ?`);
  const row = stmt.get(runId) as any;
  if (!row) return null;
  return {
    runId: row.run_id,
    filename: row.filename,
    verdict: row.verdict,
    confidence: row.confidence,
    createdAt: row.created_at,
    editedDoc: row.edited_doc,
    resultJson: JSON.parse(row.result_json),
  };
}

export function getImages(runId: string): StoredImage[] {
  const stmt = db.prepare(`SELECT img_index, mime_type, data_b64 FROM review_images WHERE run_id = ? ORDER BY img_index`);
  const rows = stmt.all(runId) as any[];
  return rows.map((r) => ({ imgIndex: r.img_index, mimeType: r.mime_type, dataB64: r.data_b64 }));
}

export function saveRunMetadata(
  runId: string,
  filename: string,
  docText: string,
  agents: string,
  depth: number,
  accessToken: string,
): void {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO run_metadata (run_id, filename, doc_text, agents, depth, access_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, filename, docText, agents, depth, accessToken, Date.now());
  } catch { /* Non-critical */ }
}

export function getRunMetadata(runId: string): RunMetadata | null {
  try {
    const row = db.prepare('SELECT * FROM run_metadata WHERE run_id = ?').get(runId) as any;
    if (!row) return null;
    return {
      runId: row.run_id,
      filename: row.filename,
      docText: row.doc_text,
      agents: row.agents,
      depth: row.depth,
      accessToken: row.access_token ?? '',
      createdAt: row.created_at,
    };
  } catch { return null; }
}
