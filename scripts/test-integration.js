#!/usr/bin/env node
/**
 * scripts/test-integration.js — Integration test runner with server lifecycle
 *
 * Starts the mdpage server on an isolated port (unless SERVER_URL is provided),
 * waits for /healthz readiness, runs all integration tests, then kills local
 * server if started here. Exits 0 on success, 1 on failure.
 *
 * Usage:
 *   node scripts/test-integration.js
 *   PORT=3457 node scripts/test-integration.js   # custom local port
 *   SERVER_URL=https://api.example.com node scripts/test-integration.js  # live API mode
 *
 * Tunables:
 *   INTEGRATION_SERVER_WAIT_MS=15000
 *   INTEGRATION_SERVER_POLL_MS=250
 *
 * Called by: npm run test:integration  (and npm run test:all)
 */

import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const PORT        = process.env.PORT ?? '3457';  // use 3457 to avoid conflict with dev server
const LIVE_URL    = process.env.SERVER_URL;
const SERVER_URL  = LIVE_URL ?? `http://localhost:${PORT}`;
const RUN_LIVE    = Boolean(LIVE_URL);
const MAX_WAIT_MS = Number(process.env.INTEGRATION_SERVER_WAIT_MS ?? 12_000);
const POLL_MS     = Number(process.env.INTEGRATION_SERVER_POLL_MS ?? 200);

let serverProc = null;

// ── Cleanup guard ─────────────────────────────────────────────────────────────

function cleanup() {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
    serverProc = null;
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
process.on('uncaughtException', (err) => { console.error(err); cleanup(); process.exit(1); });

// ── Server startup ────────────────────────────────────────────────────────────

function startServer() {
  console.log(`[integration] Starting server on port ${PORT}…`);

  serverProc = spawn(
    process.execPath,
    [path.join(ROOT, 'server.js')],
    {
      env:   { ...process.env, PORT, NODE_ENV: 'test', LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd:   ROOT,
    }
  );

  serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on('error', (err) => { console.error('[integration] Server spawn error:', err.message); });

  return serverProc;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  let lastBody = null;
  let lastErr = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });

      let body = null;
      try {
        body = await res.json();
      } catch {
        // non-json health responses are acceptable
      }

      lastStatus = res.status;
      lastBody = body;

      if (res.ok) {
        console.log(`[integration] Server ready at ${url}`);
        return true;
      }
    } catch (err) {
      lastErr = err;
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  console.error(`[integration] Timed out waiting for server at ${url}`);
  if (lastStatus !== null) {
    console.error(`[integration] Last healthz status: ${lastStatus}`);
    if (lastBody !== null) {
      console.error(`[integration] Last healthz body: ${JSON.stringify(lastBody)}`);
    }
  }
  if (lastErr) {
    console.error(`[integration] Last readiness error: ${lastErr.message}`);
  }

  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  if (RUN_LIVE) {
    console.log(`[integration] Using live API: ${SERVER_URL}`);
    console.log(`[integration] Waiting for readiness (/healthz), timeout=${MAX_WAIT_MS}ms`);
  } else {
    startServer();
  }

  const ready = await waitForServer(SERVER_URL, MAX_WAIT_MS);
  if (!ready) {
    cleanup();
    process.exit(1);
  }

  let exitCode = 0;
  try {
    console.log('[integration] Running api-phase1.test.js…\n');
    execFileSync(
      process.execPath,
      [path.join(ROOT, 'tests/integration/api-phase1.test.js')],
      {
        env:   { ...process.env, SERVER_URL },
        stdio: 'inherit',
        cwd:   ROOT,
      }
    );
    console.log('\n[integration] ✓ Integration tests passed');
  } catch (err) {
    console.error('\n[integration] ✗ Integration tests FAILED');
    exitCode = 1;
  }

  cleanup();
  process.exit(exitCode);
})();
