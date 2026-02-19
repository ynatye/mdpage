/**
 * lib/healthz.js — Data-store reachability checks for /healthz
 *
 * Separated from server.js so it can be unit-tested without standing up
 * a full Express server.
 *
 * checkDataStore(dataDir) returns:
 *   {
 *     status:  'ok' | 'degraded',
 *     checks:  {
 *       dataDir:       'ok' | 'error',
 *       index:         'ok' | 'missing' | 'corrupt' | 'error',
 *       lifecycleRuns: 'ok' | 'missing' | 'corrupt' | 'error',
 *     },
 *   }
 *
 * status === 'degraded' when:
 *   - data directory is not readable/writable, OR
 *   - data/index.json is missing, corrupt, or unreadable
 *
 * lifecycle-runs.json being missing or corrupt is non-fatal (degraded=false):
 *   it is auto-created on first sweep and its absence does not block serving.
 */

import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';

/**
 * @param {string} dataDir  Absolute or relative path to the data directory.
 *                          Defaults to './data'.
 * @returns {Promise<{ status: string, checks: object }>}
 */
export async function checkDataStore(dataDir = './data') {
  const checks = {
    dataDir:       'ok',
    index:         'ok',
    lifecycleRuns: 'ok',
  };
  let degraded = false;

  // ── 1) data dir reachable + writable ──────────────────────────────────────
  try {
    await fs.access(dataDir, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    checks.dataDir = 'error';
    degraded = true;
  }

  // ── 2) index.json readable + valid JSON ───────────────────────────────────
  try {
    const raw = await fs.readFile(path.join(dataDir, 'index.json'), 'utf8');
    try {
      const parsed = JSON.parse(raw);
      // index.json must be an object (not array, null, etc.)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        checks.index = 'corrupt';
        degraded = true;
      } else {
        checks.index = 'ok';
      }
    } catch {
      checks.index = 'corrupt';
      degraded = true;
    }
  } catch (err) {
    checks.index = err.code === 'ENOENT' ? 'missing' : 'error';
    degraded = true;
  }

  // ── 3) lifecycle-runs.json readable + valid array (non-fatal if absent) ───
  try {
    const raw = await fs.readFile(path.join(dataDir, 'lifecycle-runs.json'), 'utf8');
    try {
      const parsed = JSON.parse(raw);
      checks.lifecycleRuns = Array.isArray(parsed) ? 'ok' : 'corrupt';
      // Corrupt lifecycle-runs is unusual but non-fatal (won't block serving)
    } catch {
      checks.lifecycleRuns = 'corrupt';
    }
  } catch (err) {
    // Missing is expected on a fresh instance; treat as ok
    checks.lifecycleRuns = err.code === 'ENOENT' ? 'missing' : 'error';
  }

  return { status: degraded ? 'degraded' : 'ok', checks };
}
