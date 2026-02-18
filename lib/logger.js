/**
 * lib/logger.js — Structured logging for mdpage
 *
 * Emits JSON lines to stdout so that log aggregators (Loki, Datadog, etc.)
 * can ingest structured fields without parsing freeform text.
 *
 * Usage:
 *   import log from './lib/logger.js'
 *   log.info('publish', { slug, tier })
 *   log.warn('rate_limit', { ip, endpoint })
 *   log.error('lifecycle', { error: err.message })
 *
 * Output shape (one JSON object per line):
 * {
 *   "ts":      "2026-02-18T05:00:00.000Z",  // ISO timestamp
 *   "level":   "info",                       // debug | info | warn | error
 *   "event":   "publish",                    // free-form event key
 *   ...rest of fields                        // caller-supplied context
 * }
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Respect LOG_LEVEL env var (default: info in prod, debug in dev)
const minLevel =
  LEVELS[process.env.LOG_LEVEL] ??
  (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);

function emit(level, event, fields = {}) {
  if (LEVELS[level] < minLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  // Always write to stdout; errors also echo to stderr for visibility
  const line = JSON.stringify(entry);
  process.stdout.write(line + '\n');
  if (level === 'error') process.stderr.write(line + '\n');
}

const log = {
  debug: (event, fields) => emit('debug', event, fields),
  info:  (event, fields) => emit('info',  event, fields),
  warn:  (event, fields) => emit('warn',  event, fields),
  error: (event, fields) => emit('error', event, fields),
};

export default log;
