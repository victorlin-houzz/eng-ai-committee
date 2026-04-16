import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { dirname, basename, extname, join } from 'path';
import type { Checkpoint } from '../types.js';

/** Derive the checkpoint file path for a given input doc path. */
export function checkpointPath(inputPath: string): string {
  const dir = dirname(inputPath);
  const base = basename(inputPath, extname(inputPath));
  return join(dir, `.${base}.checkpoint.json`);
}

/** SHA-256 of doc text — used to detect if the file changed between runs. */
export function hashDoc(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Load a checkpoint if it exists and the doc hash matches.
 * Returns null if no valid checkpoint is found.
 */
export async function loadCheckpoint(
  cpPath: string,
  docHash: string,
): Promise<Checkpoint | null> {
  try {
    const raw = await readFile(cpPath, 'utf-8');
    const cp = JSON.parse(raw) as Checkpoint;
    if (cp.version !== '1') return null;
    if (cp.docHash !== docHash) {
      console.error(`⚠  Checkpoint exists but doc has changed — starting fresh.`);
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

/** Write or overwrite the checkpoint file. */
export async function saveCheckpoint(cpPath: string, cp: Checkpoint): Promise<void> {
  await writeFile(cpPath, JSON.stringify(cp, null, 2), 'utf-8');
}

/** Delete the checkpoint file after a successful complete run. */
export async function clearCheckpoint(cpPath: string): Promise<void> {
  const { unlink } = await import('fs/promises');
  try {
    await unlink(cpPath);
  } catch { /* already gone, that's fine */ }
}
