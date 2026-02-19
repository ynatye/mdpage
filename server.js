/**
 * server.js — mdpage Express server
 *
 * API surface:
 *   POST /api/publish                        — publish a new article
 *   GET  /api/articles/:slug                 — read article + metadata
 *   GET  /api/articles/:slug/status          — lightweight lifecycle status check
 *   POST /api/articles/:slug/view            — record a view (deduped daily)
 *   GET  /api/internal/lifecycle/:slug       — inspect lifecycle state (debug)
 *   POST /api/internal/lifecycle/run         — trigger a lifecycle sweep (debug)
 *   GET  /api/internal/config                — show current thresholds/limits
 *
 * Response shapes are documented inline; keep them stable for frontend consumers.
 */

import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  renderContent,
  extractTitle,
  extractDescription,
  estimateReadingTime,
} from './lib/markdown.js';
import { normalizeSlugBase, resolveSlug } from './lib/slug.js';
import { recordView, getUniqueViewCount, getViewData } from './lib/views.js';
import { runLifecycleSweep, config as lifecycleConfig } from './lib/lifecycle.js';
import { publishRateLimit, viewRateLimit, honeypot, rateLimitConfig } from './lib/ratelimit.js';
import { computeInternalStats } from './lib/stats.js';
import { buildLifecycleUx } from './lib/lifecycle-ux.js';
import { checkDataStore } from './lib/healthz.js';
import log from './lib/logger.js';
import {
  apiInternalAuth,
  dashboardAuth,
  buildLoginPage,
  buildSetCookieHeader,
  buildClearCookieHeader,
  constantTimeEqual,
  createSession,
  getCookieName,
  htmlEsc,
} from './lib/internal-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT ?? 3456;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS: dev only (in production we're same-origin via static serving)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Visitor-Id');
    if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });
}

// Serve built frontend
app.use(express.static(path.join(__dirname, 'dist')));

// ── Data directory bootstrap ──────────────────────────────────────────────────

async function ensureDataDirs() {
  await fs.mkdir('./data',          { recursive: true });
  await fs.mkdir('./data/articles', { recursive: true });
  await fs.mkdir('./data/views',    { recursive: true });
  try { await fs.access('./data/index.json'); } catch {
    await fs.writeFile('./data/index.json', '{}');
  }
  try { await fs.access('./data/lifecycle-runs.json'); } catch {
    await fs.writeFile('./data/lifecycle-runs.json', '[]');
  }

  // ── Startup integrity check ───────────────────────────────────────────────
  // Warn (but do not crash) if index.json is not valid JSON.
  // A corrupt index would silently fall back to {} in loadIndex(), masking data
  // loss; surfacing it at boot makes the problem visible before any requests land.
  try {
    const raw = await fs.readFile('./data/index.json', 'utf8');
    JSON.parse(raw);
  } catch (err) {
    log.error('startup.integrity.index', {
      error: err.message,
      hint:  'data/index.json may be corrupt — restore from backup before serving traffic',
    });
  }
}

// ── Index helpers ─────────────────────────────────────────────────────────────

async function loadIndex() {
  try {
    return JSON.parse(await fs.readFile('./data/index.json', 'utf8'));
  } catch { return {}; }
}

async function saveIndex(index) {
  // Atomic write: write to a temp file then rename so concurrent readers
  // never observe a partial JSON file (which would cause loadIndex to return {}).
  const tmp = './data/index.json.tmp';
  await fs.writeFile(tmp, JSON.stringify(index, null, 2));
  await fs.rename(tmp, './data/index.json');
}

async function loadLifecycleRuns() {
  try {
    const raw = await fs.readFile('./data/lifecycle-runs.json', 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let _lifecycleRunLock = Promise.resolve();
async function withLifecycleRunLock(fn) {
  const prev = _lifecycleRunLock;
  let release;
  _lifecycleRunLock = new Promise((r) => { release = r; });
  await prev;
  try { return await fn(); }
  finally { release(); }
}

async function appendLifecycleRun(summary) {
  await withLifecycleRunLock(async () => {
    const runs = await loadLifecycleRuns();
    // Capture up to 5 error slugs for dashboard inspection (full errors array is
    // available in server logs; here we only store slugs for quick triage).
    const errorSlugs = Array.isArray(summary?.errors)
      ? summary.errors.slice(0, 5).map((e) => (typeof e === 'object' ? (e.slug ?? String(e)) : String(e)))
      : [];
    runs.push({
      ts: new Date().toISOString(),
      evaluated: Number(summary?.evaluated ?? 0),
      transitions: {
        at_risk: Number(summary?.transitions?.at_risk ?? 0),
        recovered: Number(summary?.transitions?.recovered ?? 0),
        expired: Number(summary?.transitions?.expired ?? 0),
        no_change: Number(summary?.transitions?.no_change ?? 0),
        skipped: Number(summary?.transitions?.skipped ?? 0),
      },
      errors:     Array.isArray(summary?.errors) ? summary.errors.length : 0,
      errorSlugs, // slugs that failed evaluation (empty array when no errors)
    });

    const capped = runs.slice(-500);
    const tmp = './data/lifecycle-runs.json.tmp';
    await fs.writeFile(tmp, JSON.stringify(capped, null, 2));
    await fs.rename(tmp, './data/lifecycle-runs.json');
  });
}

// Serialised index read-modify-write mutex (prevents interleaving concurrent publishes)
let _indexLock = Promise.resolve();
async function withIndexLock(fn) {
  const prev = _indexLock;
  let release;
  _indexLock = new Promise((r) => { release = r; });
  await prev;
  try { return await fn(); }
  finally { release(); }
}

// ── Lifecycle sweep concurrency guard ─────────────────────────────────────────
//
// Prevents two sweep operations from running in parallel — e.g., a manual
// API trigger arriving while the scheduler is already mid-sweep.
//
// Usage:
//   if (_sweepInFlight) return res.status(409).json({ error: '…' });
//   _sweepInFlight = true;
//   try { … } finally { _sweepInFlight = false; }
//
// Not a mutex: we deliberately reject concurrent callers rather than queue them,
// because two parallel sweeps over the same index would produce duplicate
// transitions and double-increment run-history counters.

let _sweepInFlight = false;

// ── Slug availability check ───────────────────────────────────────────────────

async function isSlugAvailable(slug) {
  const index = await loadIndex();
  return !Object.prototype.hasOwnProperty.call(index, slug);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/publish
 *
 * Request body:
 * {
 *   markdown:   string   — full markdown content (required)
 *   tier:       string   — "free" | "paid" (default: "free")
 *   slug:       string?  — custom slug base for paid tier; ignored for free
 *   _hp:        string?  — honeypot field; must be empty/absent for real requests
 * }
 *
 * Response (201 Created):
 * {
 *   success:    true
 *   slug:       string
 *   slugBase:   string
 *   url:        string   — "/{slug}"
 *   tier:       "free" | "paid"
 *   adEnabled:  boolean
 *   status:     "published"
 *   createdAt:  ISO string
 *   updatedAt:  ISO string | undefined
 * }
 */
app.post(
  '/api/publish',
  publishRateLimit(),
  honeypot(),
  async (req, res) => {
    try {
      const { markdown, slug: customSlug, tier: rawTier = 'free' } = req.body;

      // ── Input validation ────────────────────────────────────────────────
      if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
        return res.status(400).json({ error: 'Markdown content is required' });
      }
      if (markdown.trim().length > 1024 * 1024) {
        return res.status(400).json({ error: 'Markdown content too large (max 1MB)' });
      }

      const tier = rawTier === 'paid' ? 'paid' : 'free';

      const title = extractTitle(markdown);
      if (!title || title === 'Untitled') {
        return res.status(400).json({
          error: 'Article must have a title (first line: "# Your Title")',
        });
      }

      // ── Slug generation ──────────────────────────────────────────────────
      // For paid: use custom slug or derive from title (no suffix)
      // For free: always derive from title + random suffix (custom input ignored)
      const rawBase = tier === 'paid' && customSlug?.trim()
        ? customSlug.trim()
        : title;

      const slugBase = normalizeSlugBase(rawBase);
      if (!slugBase) {
        return res.status(400).json({ error: 'Could not derive a valid slug from the title' });
      }

      let slug;
      try {
        slug = await resolveSlug(tier, slugBase, isSlugAvailable);
      } catch (err) {
        if (err.code === 'SLUG_CONFLICT') {
          return res.status(409).json({
            error: `Slug "${err.slug}" is already taken. Choose a different title or slug.`,
          });
        }
        if (err.code === 'SLUG_EXHAUSTED') {
          return res.status(500).json({ error: 'Could not generate a unique slug. Please retry.' });
        }
        throw err;
      }

      // ── Pre-compute metadata ─────────────────────────────────────────────
      const description  = extractDescription(markdown);
      const readingTime  = estimateReadingTime(markdown);
      const adEnabled    = tier === 'free';

      // ── Write article file (outside lock) ────────────────────────────────
      const articlePath = path.join('./data/articles', `${slug}.md`);
      await fs.writeFile(articlePath, markdown, 'utf8');

      // ── Update index under mutex ─────────────────────────────────────────
      let isUpdate;
      let createdAt;
      let updatedAt;

      await withIndexLock(async () => {
        const index = await loadIndex();
        isUpdate  = !!index[slug];
        createdAt = isUpdate ? index[slug].createdAt : new Date().toISOString();
        updatedAt = isUpdate ? new Date().toISOString() : undefined;

        index[slug] = {
          slug,
          slugBase,
          title,
          tier,
          adEnabled,
          status: isUpdate ? (index[slug].status ?? 'published') : 'published',
          createdAt,
          ...(updatedAt && { updatedAt }),
          description,
          readingTime,
          last30dUniqueViews: isUpdate ? (index[slug].last30dUniqueViews ?? 0) : 0,
          totalViews: isUpdate ? (index[slug].totalViews ?? 0) : 0,
          atRiskStartedAt: isUpdate ? (index[slug].atRiskStartedAt ?? null) : null,
          expiresAt:       isUpdate ? (index[slug].expiresAt       ?? null) : null,
        };

        await saveIndex(index);
      });

      log.info('publish', {
        slug,
        slugBase,
        tier,
        adEnabled,
        isUpdate,
        title,
      });

      return res.status(201).json({
        success:   true,
        slug,
        slugBase,
        url:       `/${slug}`,
        tier,
        adEnabled,
        status:    'published',
        createdAt,
        ...(updatedAt && { updatedAt }),
      });

    } catch (err) {
      log.error('publish.error', { error: err.message, stack: err.stack });

      if (err.code === 'ENOSPC') return res.status(507).json({ error: 'Server storage full' });
      if (err.code === 'EACCES') return res.status(500).json({ error: 'Server permission error' });

      return res.status(500).json({
        error: 'Failed to publish article',
        ...(process.env.NODE_ENV !== 'production' && { debug: err.message }),
      });
    }
  }
);

/**
 * GET /api/articles/:slug
 *
 * Response (200 OK):
 * {
 *   title:    string
 *   content:  string   — rendered HTML (body only, H1 stripped)
 *   meta: {
 *     slug:               string
 *     slugBase:           string
 *     tier:               "free" | "paid"
 *     adEnabled:          boolean
 *     status:             "published" | "at_risk" | "expired"
 *     description:        string
 *     createdAt:          ISO string
 *     updatedAt:          ISO string | undefined
 *     readingTime:        string
 *     last30dUniqueViews: number
 *     expiresAt:          ISO string | null
 *     atRiskStartedAt:    ISO string | null
 *   }
 * }
 *
 * Expired posts return 410 Gone.
 */
app.get('/api/articles/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const index   = await loadIndex();
    const article = index[slug];

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Expired posts are no longer publicly served — include title so clients
    // can render a meaningful "Expired: <title>" page without a second request.
    if (article.status === 'expired') {
      return res.status(410).json({
        error: 'This article has expired and is no longer available.',
        status: 'expired',
        slug,
        title:  article.title ?? null,
      });
    }

    const articlePath = path.join('./data/articles', `${slug}.md`);
    let markdown;
    try {
      markdown = await fs.readFile(articlePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Article content not found' });
      throw err;
    }

    const content = renderContent(markdown);
    const lux = buildLifecycleUx(article);

    return res.json({
      title:   article.title,
      content,
      meta: {
        slug:               article.slug,
        slugBase:           article.slugBase ?? article.slug,
        tier:               article.tier        ?? 'free',
        adEnabled:          article.adEnabled    ?? true,
        status:             article.status       ?? 'published',
        description:        article.description  ?? '',
        createdAt:          article.createdAt,
        updatedAt:          article.updatedAt,
        readingTime:        article.readingTime  ?? '',
        last30dUniqueViews: article.last30dUniqueViews ?? 0,
        expiresAt:          article.expiresAt    ?? null,
        atRiskStartedAt:    article.atRiskStartedAt ?? null,
      },
      // Precomputed lifecycle UX fields — use these in frontend components
      // instead of computing urgency/countdown client-side.
      lifecycleUx: lux,
    });

  } catch (err) {
    log.error('article.get.error', { error: err.message });
    return res.status(500).json({ error: 'Error loading article' });
  }
});

/**
 * GET /api/articles/:slug/status
 *
 * Lightweight lifecycle status check — returns only the lifecycle fields
 * without reading or rendering the full article content.
 * Useful for polling at-risk countdowns or showing status badges without
 * incurring the cost of a full GET /api/articles/:slug.
 *
 * Response (200 OK):
 * {
 *   slug:         string,
 *   status:       "published" | "at_risk" | "expired",
 *   tier:         "free" | "paid",
 *   lifecycleUx:  { status, statusLabel, daysLeft, daysLeftText, urgency, expiresAt }
 * }
 *
 * 404 when slug unknown; 410 with lifecycleUx when expired (consistent with GET /:slug).
 */
app.get('/api/articles/:slug/status', async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const index   = await loadIndex();
    const article = index[slug];

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const lux = buildLifecycleUx(article);

    if (article.status === 'expired') {
      return res.status(410).json({
        slug,
        status: 'expired',
        tier:   article.tier ?? 'free',
        title:  article.title ?? null,
        lifecycleUx: lux,
      });
    }

    return res.json({
      slug,
      status: article.status ?? 'published',
      tier:   article.tier   ?? 'free',
      lifecycleUx: lux,
    });

  } catch (err) {
    log.error('article.status.error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/articles/:slug/view
 *
 * Records a view, deduplicating by fingerprint (visitorId|date or IP|UA|date).
 * Idempotent: subsequent calls on the same day from the same visitor are no-ops.
 *
 * Visitor identity resolution (first match wins):
 *   1. X-Visitor-Id header  — client-supplied stable UUID (preferred)
 *   2. IP + User-Agent      — fallback server-side fingerprint
 *
 * Response (200 OK):
 * {
 *   recorded:    boolean   — true if this was a new unique view
 *   date:        string    — YYYY-MM-DD of the bucket
 * }
 */
app.post('/api/articles/:slug/view', viewRateLimit(), async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Verify article exists and is not expired
    const index   = await loadIndex();
    const article = index[slug];

    if (!article) return res.status(404).json({ error: 'Article not found' });
    if (article.status === 'expired') return res.status(410).json({ error: 'Article expired' });

    // Visitor identity: prefer explicit X-Visitor-Id (client-side stable UUID,
    // e.g. from localStorage) when present; fall back to IP + UA fingerprint.
    const visitorId = req.headers['x-visitor-id']?.trim() ?? '';
    const ip        = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
                      || req.socket?.remoteAddress
                      || 'unknown';
    const userAgent = req.headers['user-agent'] ?? '';
    // Use visitorId as the identity string when provided; otherwise derive from IP+UA.
    const identity  = visitorId || `${ip}|${userAgent}`;

    const result = await recordView(slug, identity, '');

    // Bump totalViews counter in index (approximate, non-locked for performance)
    if (result.recorded) {
      withIndexLock(async () => {
        const fresh = await loadIndex();
        if (fresh[slug]) {
          fresh[slug].totalViews = (fresh[slug].totalViews ?? 0) + 1;
          await saveIndex(fresh);
        }
      }).catch((err) => log.error('view.totalViews.error', { error: err.message }));
    }

    return res.json({
      recorded: result.recorded,
      date:     result.date,
    });

  } catch (err) {
    log.error('view.error', { error: err.message });
    return res.status(500).json({ error: 'Error recording view' });
  }
});

// ── Internal / admin endpoints ────────────────────────────────────────────────

// Auth for /api/internal/* and /internal routes is handled by lib/internal-auth.js.
// apiInternalAuth()  → JSON 401 on failure (x-internal-token header or session cookie)
// dashboardAuth()    → HTML login form on failure (session cookie or ?token= redirect)

/**
 * GET /api/internal/lifecycle/:slug
 *
 * Returns the current lifecycle state for a slug plus 30-day view count.
 * Useful for debugging without triggering a full sweep.
 *
 * Response:
 * {
 *   slug:               string
 *   status:             string
 *   tier:               string
 *   last30dUniqueViews: number
 *   expiresAt:          ISO string | null
 *   atRiskStartedAt:    ISO string | null
 *   viewData:           object   — raw daily view buckets
 * }
 */
app.get('/api/internal/lifecycle/:slug', apiInternalAuth(), async (req, res) => {
  try {
    const { slug } = req.params;
    const index    = await loadIndex();
    const article  = index[slug];

    if (!article) return res.status(404).json({ error: 'Article not found' });

    const views    = await getUniqueViewCount(slug, 30);
    const viewData = await getViewData(slug);

    return res.json({
      slug,
      status:             article.status            ?? 'published',
      tier:               article.tier              ?? 'free',
      createdAt:          article.createdAt,
      last30dUniqueViews: views,
      expiresAt:          article.expiresAt         ?? null,
      atRiskStartedAt:    article.atRiskStartedAt   ?? null,
      lifecycleConfig,
      viewData,
    });

  } catch (err) {
    log.error('lifecycle.inspect.error', { error: err.message });
    return res.status(500).json({ error: 'Error inspecting lifecycle' });
  }
});

/**
 * POST /api/internal/lifecycle/run
 *
 * Manually trigger the lifecycle sweep over all free posts.
 * In production this would be triggered by a cron job or scheduler.
 *
 * Response:
 * {
 *   evaluated:    number
 *   transitions:  { at_risk, recovered, expired, no_change, skipped }
 *   errors:       Array<{ slug, error }>
 * }
 */
app.post('/api/internal/lifecycle/run', apiInternalAuth(), async (req, res) => {
  if (_sweepInFlight) {
    log.warn('lifecycle.run.rejected', { reason: 'sweep already in flight' });
    return res.status(409).json({
      error: 'A lifecycle sweep is already in progress. Try again in a moment.',
      sweepInFlight: true,
    });
  }
  _sweepInFlight = true;
  try {
    const summary = await runLifecycleSweep(loadIndex, saveIndex, withIndexLock);
    await appendLifecycleRun(summary);
    return res.json(summary);
  } catch (err) {
    log.error('lifecycle.run.error', { error: err.message });
    return res.status(500).json({ error: 'Lifecycle sweep failed', details: err.message });
  } finally {
    _sweepInFlight = false;
  }
});

/**
 * POST /api/internal/lifecycle/dry-run
 *
 * Preview what the lifecycle sweep would do — evaluates all articles and returns
 * the same summary as /lifecycle/run but WITHOUT persisting any transitions.
 * Safe to call at any time; does not mutate index state.
 *
 * Response: same shape as /lifecycle/run, plus `dryRun: true`.
 */
app.post('/api/internal/lifecycle/dry-run', apiInternalAuth(), async (req, res) => {
  // Dry-runs read the same index snapshot, so running one while a live sweep
  // is committing changes could produce slightly stale results.  Surface this
  // so the operator knows to retry after the in-flight sweep finishes.
  if (_sweepInFlight) {
    log.warn('lifecycle.dryrun.rejected', { reason: 'sweep already in flight' });
    return res.status(409).json({
      error:         'A lifecycle sweep is currently in progress. Dry-run may show stale results — retry shortly.',
      dryRun:        true,
      sweepInFlight: true,
    });
  }
  try {
    // Pass a no-op saveIndex and a pass-through lock: evaluation runs fully
    // but no writes are committed to data/index.json.
    const noopSave = async () => {};
    const noopLock = async (fn) => fn();
    const summary  = await runLifecycleSweep(loadIndex, noopSave, noopLock);
    return res.json({ ...summary, dryRun: true });
  } catch (err) {
    log.error('lifecycle.dryrun.error', { error: err.message });
    return res.status(500).json({ error: 'Dry-run sweep failed', details: err.message });
  }
});

/**
 * GET /api/internal/config
 *
 * Expose current runtime configuration for debugging.
 */
app.get('/api/internal/config', apiInternalAuth(), (_req, res) => {
  return res.json({
    lifecycle:     lifecycleConfig,
    rateLimit:     rateLimitConfig,
    env:           process.env.NODE_ENV ?? 'development',
    sweepInFlight: _sweepInFlight,
  });
});

/**
 * GET /api/internal/stats
 *
 * Returns a high-level health summary across all articles.
 * Useful for dashboards and monitoring scripts.
 *
 * Response:
 *   {
 *     total:     number,   // all articles in index
 *     published: number,   // status = "published"
 *     at_risk:   number,   // status = "at_risk"
 *     expired:   number,   // status = "expired"
 *     free:      number,   // tier = "free"
 *     paid:      number,   // tier = "paid"
 *     ts:        string,   // ISO timestamp of snapshot
 *   }
 */
app.get('/api/internal/stats', apiInternalAuth(), async (_req, res) => {
  try {
    const index = await loadIndex();
    const runs = await loadLifecycleRuns();
    const stats = computeInternalStats(index, runs);

    log.info('stats.requested', {
      total: stats.total,
      atRisk: stats.at_risk,
      expiringSoon: stats.expiringSoon.length,
    });
    return res.json(stats);
  } catch (err) {
    log.error('stats.error', { error: err.message });
    return res.status(500).json({ error: 'Error computing stats' });
  }
});

/**
 * POST /internal/auth
 *
 * Login handler for the dashboard.  Accepts token from POST body (not URL),
 * validates it, issues a signed HttpOnly session cookie, then redirects to /internal.
 *
 * Using POST keeps the token out of the URL (no browser history, no server logs).
 */
app.post('/internal/auth', express.urlencoded({ extended: false }), (req, res) => {
  const expected = (process.env.INTERNAL_DASHBOARD_TOKEN ?? '').trim();
  // If no token is configured, redirect straight to dashboard (no auth required)
  if (!expected) { res.setHeader('Location', '/internal'); return res.status(302).end(); }

  const provided = (req.body?.token ?? '').trim();
  const isProd   = process.env.NODE_ENV === 'production';
  const cookieName = getCookieName(isProd);

  if (!constantTimeEqual(provided, expected)) {
    // Wrong token → re-show login page with error message
    return res.status(401).type('html').send(buildLoginPage('Invalid token. Please try again.'));
  }

  // Valid token → issue session cookie and redirect to clean URL
  const session = createSession(expected);
  res.setHeader('Set-Cookie', buildSetCookieHeader(cookieName, session, isProd));
  res.setHeader('Location', '/internal');
  return res.status(302).end();
});

/**
 * GET /internal/logout
 *
 * Clear the session cookie and redirect to login page.
 */
app.get('/internal/logout', (req, res) => {
  const isProd     = process.env.NODE_ENV === 'production';
  const cookieName = getCookieName(isProd);
  res.setHeader('Set-Cookie', buildClearCookieHeader(cookieName, isProd));
  res.setHeader('Location', '/internal');
  return res.status(302).end();
});

/**
 * POST /internal/actions/lifecycle-run
 *
 * Dashboard-triggered lifecycle sweep.  Auth via session cookie (same as GET /internal).
 * On completion, redirects back with a flash param.
 */
app.post('/internal/actions/lifecycle-run', dashboardAuth(), async (req, res) => {
  try {
    const summary = await runLifecycleSweep(loadIndex, saveIndex, withIndexLock);
    await appendLifecycleRun(summary);
    log.info('lifecycle.dashboard.run', summary);
    res.setHeader('Location', '/internal?flash=lifecycle-ok');
    return res.status(302).end();
  } catch (err) {
    log.error('lifecycle.dashboard.run.error', { error: err.message });
    res.setHeader('Location', '/internal?flash=lifecycle-err');
    return res.status(302).end();
  }
});

/**
 * GET /internal
 *
 * Operations dashboard.
 * Auth: session cookie (set via POST /internal/auth) or ?token= query param (one-time,
 * redirects to clean URL after setting cookie).  Falls back to login page.
 * When INTERNAL_DASHBOARD_TOKEN is unset the dashboard is open with a warning banner.
 */
app.get('/internal', dashboardAuth(), async (req, res) => {
  try {
    const stats    = computeInternalStats(await loadIndex(), await loadLifecycleRuns());
    const esc      = htmlEsc;
    const isOpen   = !(process.env.INTERNAL_DASHBOARD_TOKEN ?? '').trim();
    const flash    = req.query?.flash ?? '';

    // ── Sub-renderers ───────────────────────────────────────────────────────

    function statusBadge(status) {
      const cls = { published: 'badge-ok', at_risk: 'badge-warn', expired: 'badge-err' }[status] ?? 'badge-muted';
      return `<span class="badge ${cls}">${esc(status)}</span>`;
    }

    function tierBadge(tier) {
      return `<span class="badge ${tier === 'paid' ? 'badge-paid' : 'badge-free'}">${esc(tier)}</span>`;
    }

    const flashHtml = flash === 'lifecycle-ok'
      ? '<div class="flash flash-ok">✓ Lifecycle sweep completed successfully.</div>'
      : flash === 'lifecycle-err'
        ? '<div class="flash flash-err">✗ Lifecycle sweep failed — check server logs.</div>'
        : '';

    const openWarn = isOpen
      ? '<div class="warn-banner">⚠ Dashboard is open — set <code>INTERNAL_DASHBOARD_TOKEN</code> to require authentication.</div>'
      : '';

    const expiringRows = stats.expiringSoon.length
      ? stats.expiringSoon.map((p) => `
        <tr>
          <td><a href="/${esc(p.slug)}" target="_blank" rel="noopener">${esc(p.slug)}</a></td>
          <td>${esc(p.title ?? '—')}</td>
          <td>${tierBadge(p.tier)}</td>
          <td class="${p.daysRemaining <= 2 ? 'text-danger' : p.daysRemaining <= 4 ? 'text-warn' : ''}">${p.daysRemaining}d</td>
          <td class="text-mono text-muted">${esc(p.expiresAt)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">No posts expiring in the next 7 days</td></tr>';

    const topRows = stats.topPosts30d.length
      ? stats.topPosts30d.map((p) => `
        <tr>
          <td><a href="/${esc(p.slug)}" target="_blank" rel="noopener">${esc(p.slug)}</a></td>
          <td>${esc(p.title ?? '—')}</td>
          <td>${tierBadge(p.tier)}</td>
          <td class="num">${p.last30dUniqueViews}</td>
          <td>${statusBadge(p.status)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">No posts published yet</td></tr>';

    const logoutLink = isOpen ? '' : '<a href="/internal/logout" class="btn-logout">Sign out</a>';

    // ── Page ────────────────────────────────────────────────────────────────

    return res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>mdpage — internal</title>
<style>
/* ── Reset & base ─────────────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;font-size:14px;line-height:1.5}

/* ── Header ──────────────────────────────────────────────────────────── */
.header{background:#1e293b;border-bottom:1px solid #334155;padding:14px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.logo{font-size:18px;font-weight:700;color:#f8fafc;letter-spacing:-0.5px;text-decoration:none}
.logo span{color:#6366f1}
.logo-tag{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;background:#1e3a5f;color:#60a5fa;border:1px solid #1d4ed8;padding:2px 7px;border-radius:999px}
.header-right{margin-left:auto;display:flex;align-items:center;gap:12px}
.header-ts{font-size:11px;color:#64748b}
.btn-logout{font-size:12px;padding:5px 12px;background:transparent;border:1px solid #334155;color:#94a3b8;border-radius:6px;text-decoration:none;cursor:pointer}
.btn-logout:hover{border-color:#6366f1;color:#a5b4fc}

/* ── Layout ──────────────────────────────────────────────────────────── */
.container{max-width:1200px;margin:0 auto;padding:20px 20px 40px}

/* ── Flash / warning banners ─────────────────────────────────────────── */
.flash,.warn-banner{padding:10px 14px;border-radius:6px;margin:0 0 16px;font-size:13px}
.flash-ok{background:#14532d;color:#4ade80;border:1px solid #166534}
.flash-err{background:#3f1515;color:#f87171;border:1px solid #7f1d1d}
.warn-banner{background:#422006;color:#fbbf24;border:1px solid #92400e}
.warn-banner code{font-size:11px;background:rgba(0,0,0,.3);padding:1px 5px;border-radius:3px}

/* ── Stat cards ──────────────────────────────────────────────────────── */
.section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:10px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:28px}
.card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px 16px}
.card-label{font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px}
.card-val{font-size:28px;font-weight:700;line-height:1;color:#f1f5f9}
.card.c-warn .card-val{color:#fbbf24}
.card.c-err  .card-val{color:#f87171}
.card.c-ok   .card-val{color:#34d399}

/* ── Transitions bar ─────────────────────────────────────────────────── */
.trans-bar{display:flex;gap:20px;flex-wrap:wrap;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:14px 18px;margin-bottom:28px;align-items:flex-end}
.tr-item{display:flex;flex-direction:column;gap:2px}
.tr-label{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.3px}
.tr-val{font-size:22px;font-weight:700;line-height:1;color:#f1f5f9}
.tr-val.orange{color:#fb923c}
.tr-val.red{color:#f87171}
.tr-val.green{color:#34d399}
.trans-desc{margin-left:auto;font-size:11px;color:#475569;align-self:center;text-align:right}

/* ── Actions row ─────────────────────────────────────────────────────── */
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
.btn-run{padding:8px 16px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s}
.btn-run:hover{background:#4f46e5}
.btn-run:active{opacity:.8}
.btn-secondary{padding:8px 14px;background:transparent;color:#94a3b8;border:1px solid #334155;border-radius:6px;font-size:13px;cursor:pointer;text-decoration:none}
.btn-secondary:hover{border-color:#6366f1;color:#a5b4fc}

/* ── Tables ──────────────────────────────────────────────────────────── */
.section{margin-bottom:32px}
.table-wrap{overflow-x:auto;border:1px solid #334155;border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:480px}
thead th{background:#1e293b;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#94a3b8;white-space:nowrap;border-bottom:1px solid #334155}
tbody tr{border-bottom:1px solid #1a2540}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:rgba(30,41,59,.6)}
tbody td{padding:10px 14px;color:#cbd5e1;vertical-align:middle}
.empty-cell{text-align:center;padding:28px;color:#475569;font-size:13px}

/* ── Typography helpers ──────────────────────────────────────────────── */
a{color:#818cf8;text-decoration:none}a:hover{text-decoration:underline}
.num{font-feature-settings:"tnum";font-variant-numeric:tabular-nums;text-align:right}
.text-muted{color:#64748b}
.text-mono{font-family:ui-monospace,'Cascadia Code','Fira Code',monospace;font-size:12px}
.text-warn{color:#fbbf24}
.text-danger{color:#f87171}
.text-ok{color:#34d399}

/* ── Status/tier badges ──────────────────────────────────────────────── */
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.badge-ok  {background:#14532d;color:#4ade80}
.badge-warn{background:#451a03;color:#fb923c}
.badge-err {background:#3f1515;color:#f87171}
.badge-paid{background:#2e1065;color:#c4b5fd}
.badge-free{background:#1e293b;color:#94a3b8;border:1px solid #334155}
.badge-muted{background:#1e293b;color:#64748b;border:1px solid #334155}

/* ── Footer ──────────────────────────────────────────────────────────── */
.footer{margin-top:40px;border-top:1px solid #1e293b;padding-top:16px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11px;color:#475569}
.footer a{color:#64748b}
</style>
</head>
<body>

<div class="header">
  <a class="logo" href="/internal">md<span>page</span></a>
  <span class="logo-tag">internal</span>
  <div class="header-right">
    <span class="header-ts">Snapshot: ${esc(stats.ts)}</span>
    ${logoutLink}
  </div>
</div>

<div class="container">

${openWarn}
${flashHtml}

<!-- Stat cards -->
<div class="section-label">Overview</div>
<div class="cards">
  <div class="card"><div class="card-label">Total</div><div class="card-val">${stats.total}</div></div>
  <div class="card c-ok"><div class="card-label">Published</div><div class="card-val">${stats.published}</div></div>
  <div class="card ${stats.at_risk > 0 ? 'c-warn' : ''}"><div class="card-label">At risk</div><div class="card-val">${stats.at_risk}</div></div>
  <div class="card ${stats.expired > 0 ? 'c-err' : ''}"><div class="card-label">Expired</div><div class="card-val">${stats.expired}</div></div>
  <div class="card"><div class="card-label">Free</div><div class="card-val">${stats.free}</div></div>
  <div class="card"><div class="card-label">Paid</div><div class="card-val">${stats.paid}</div></div>
  <div class="card"><div class="card-label">Total views</div><div class="card-val">${stats.totalViews.toLocaleString()}</div></div>
  <div class="card ${stats.zeroViewsCount > 0 ? 'c-warn' : ''}"><div class="card-label">Zero-view free</div><div class="card-val">${stats.zeroViewsCount}</div></div>
  <div class="card"><div class="card-label">New (7d)</div><div class="card-val">${stats.publishedLast7d}</div></div>
</div>

<!-- Transitions 24h -->
<div class="section-label">Transitions (last 24h)</div>
<div class="trans-bar">
  <div class="tr-item"><span class="tr-label">→ At risk</span><span class="tr-val ${stats.transitions24h.at_risk > 0 ? 'orange' : ''}">${stats.transitions24h.at_risk}</span></div>
  <div class="tr-item"><span class="tr-label">→ Recovered</span><span class="tr-val ${stats.transitions24h.recovered > 0 ? 'green' : ''}">${stats.transitions24h.recovered}</span></div>
  <div class="tr-item"><span class="tr-label">→ Expired</span><span class="tr-val ${stats.transitions24h.expired > 0 ? 'red' : ''}">${stats.transitions24h.expired}</span></div>
  <div class="trans-desc">Last sweep:<br/><strong>${esc(stats.lastLifecycleRunAt ?? 'never')}</strong></div>
</div>

<!-- Actions -->
<div class="actions">
  <form method="POST" action="/internal/actions/lifecycle-run" style="margin:0" id="lc-run-form" onsubmit="return confirmRun(event)">
    <button class="btn-run" type="submit" id="btn-run"${_sweepInFlight ? ' disabled title="A sweep is already running — refresh in a moment"' : ''}>
      ${_sweepInFlight ? '⏳ Sweep in progress…' : '▶ Run lifecycle sweep'}
    </button>
  </form>
  <button class="btn-secondary" id="btn-dryrun" onclick="runDryRun()" type="button">🔍 Preview (dry run)</button>
  <a class="btn-secondary" href="/internal">↻ Refresh</a>
  <a class="btn-secondary" href="/api/internal/stats" target="_blank">⤤ Stats JSON</a>
  <a class="btn-secondary" href="/healthz" target="_blank">♥ Healthz</a>
</div>

<!-- Dry-run result panel (hidden until triggered) -->
<div id="dryrun-panel" style="display:none;margin-bottom:20px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <span style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">Dry-run preview</span>
    <button onclick="document.getElementById('dryrun-panel').style.display='none'" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
  </div>
  <pre id="dryrun-output" style="font-family:ui-monospace,'Cascadia Code',monospace;font-size:12px;color:#cbd5e1;white-space:pre-wrap;margin:0">Loading…</pre>
</div>

<!-- Expiring soon -->
<div class="section">
  <div class="section-label">Expiring soon (≤ 7 days)</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Slug</th><th>Title</th><th>Tier</th><th>Days left</th><th>Expires at</th></tr></thead>
      <tbody>${expiringRows}</tbody>
    </table>
  </div>
</div>

<!-- Top posts -->
<div class="section">
  <div class="section-label">Top posts — 30d unique views</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Slug</th><th>Title</th><th>Tier</th><th class="num">30d uniques</th><th>Status</th></tr></thead>
      <tbody>${topRows}</tbody>
    </table>
  </div>
</div>

<!-- Lifecycle run history -->
<div class="section">
  <div class="section-label">Lifecycle run history (last ${stats.lifecycleRunHistory.length || 0} runs · ${stats.sweepCount24h} in past 24h)</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Timestamp</th><th class="num">Evaluated</th><th class="num">→ At risk</th><th class="num">→ Recovered</th><th class="num">→ Expired</th><th class="num">Errors</th></tr></thead>
      <tbody>${stats.lifecycleRunHistory.length
        ? stats.lifecycleRunHistory.map((r) => {
          const slugList = r.errorSlugs?.length ? r.errorSlugs.map(esc).join(', ') : '';
          const errTitle = slugList ? ` title="Failed slugs: ${slugList}"` : '';
          const errDetail = slugList
            ? `<br/><span class="text-mono" style="font-size:10px;color:#f87171;opacity:.7">${slugList}</span>`
            : '';
          return `
        <tr>
          <td class="text-mono text-muted">${esc(r.ts)}</td>
          <td class="num">${r.evaluated}</td>
          <td class="num ${r.at_risk  > 0 ? 'text-warn' : ''}">${r.at_risk}</td>
          <td class="num ${r.recovered > 0 ? 'text-ok'  : ''}">${r.recovered}</td>
          <td class="num ${r.expired  > 0 ? 'text-danger' : ''}">${r.expired}</td>
          <td class="num ${r.errors   > 0 ? 'text-danger' : ''}"${errTitle}>${r.errors}${errDetail}</td>
        </tr>`;
        }).join('')
        : '<tr><td colspan="6" class="empty-cell">No lifecycle runs recorded yet</td></tr>'}
      </tbody>
    </table>
  </div>
</div>

<div class="footer">
  <span>mdpage internal dashboard</span>
  <span>Auto-refresh every 5 min · <a href="/healthz" target="_blank">/healthz</a></span>
</div>

</div><!-- /container -->

<meta http-equiv="refresh" content="300;url=/internal"/>

<script>
// ── Lifecycle run safety guard ───────────────────────────────────────────────
function confirmRun(e) {
  const btn = document.getElementById('btn-run');
  if (btn.dataset.confirmed !== 'yes') {
    e.preventDefault();
    btn.textContent = '⚠ Click again to confirm sweep';
    btn.dataset.confirmed = 'yes';
    btn.style.background = '#b45309';
    // Reset after 4 seconds if not confirmed
    setTimeout(() => {
      btn.textContent = '▶ Run lifecycle sweep';
      btn.dataset.confirmed = '';
      btn.style.background = '';
    }, 4000);
    return false;
  }
  // Second click: disable to prevent double-submit
  btn.disabled = true;
  btn.textContent = '⏳ Running sweep…';
  return true;
}

// ── Dry-run preview ──────────────────────────────────────────────────────────
async function runDryRun() {
  const panel  = document.getElementById('dryrun-panel');
  const output = document.getElementById('dryrun-output');
  const drbtn  = document.getElementById('btn-dryrun');

  panel.style.display = 'block';
  output.textContent  = 'Running dry-run evaluation…';
  drbtn.disabled      = true;
  drbtn.textContent   = '⏳ Previewing…';

  try {
    const res  = await fetch('/api/internal/lifecycle/dry-run', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      output.textContent = 'Error: ' + (data.error ?? res.statusText);
    } else {
      const { evaluated, transitions, errors, dryRun } = data;
      const lines = [
        \`Dry run: \${dryRun ? 'yes (no changes written)' : 'unknown'}\`,
        \`Evaluated: \${evaluated}\`,
        \`→ Would enter at_risk: \${transitions.at_risk}\`,
        \`→ Would recover:       \${transitions.recovered}\`,
        \`→ Would expire:        \${transitions.expired}\`,
        \`   No change:          \${transitions.no_change}\`,
        \`   Skipped (paid/new): \${transitions.skipped}\`,
        \`Errors: \${errors?.length ?? 0}\`,
      ];
      if (errors?.length > 0) {
        lines.push('', 'Error slugs:');
        errors.forEach((e) => lines.push(\`  \${e.slug}: \${e.error}\`));
      }
      output.textContent = lines.join('\\n');
    }
  } catch (err) {
    output.textContent = 'Request failed: ' + err.message;
  } finally {
    drbtn.disabled    = false;
    drbtn.textContent = '🔍 Preview (dry run)';
  }
}
</script>

</body>
</html>`);
  } catch (err) {
    log.error('internal.dashboard.error', { error: err.message });
    return res.status(500).type('html').send(`<!doctype html><html><head><meta charset="utf-8"/><title>mdpage — error</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}</style>
</head><body><div><h1 style="font-size:48px;margin-bottom:8px">500</h1><p style="color:#94a3b8">Internal dashboard error — check server logs.</p><p style="margin-top:16px"><a href="/internal" style="color:#818cf8">↩ Retry</a></p></div></body></html>`);
  }
});

/**
 * GET /healthz
 *
 * Liveness + data-store reachability probe for Docker / load balancers.
 *
 * Always returns HTTP 200 so that a degraded-but-alive server is still
 * counted as "up" by the load balancer.  Monitoring scripts should inspect
 * the `status` field:
 *   - "ok"       → all data store checks passed
 *   - "degraded" → data directory or index.json is inaccessible / corrupt
 *
 * Response shape:
 * {
 *   status:        "ok" | "degraded",
 *   sweepInFlight: boolean,
 *   checks: {
 *     dataDir:       "ok" | "error",
 *     index:         "ok" | "missing" | "corrupt" | "error",
 *     lifecycleRuns: "ok" | "missing" | "corrupt" | "error",
 *   },
 *   ts: string  // ISO timestamp
 * }
 */
app.get('/healthz', async (_req, res) => {
  try {
    const { status, checks } = await checkDataStore('./data');
    return res.json({ status, sweepInFlight: _sweepInFlight, checks, ts: new Date().toISOString() });
  } catch (err) {
    // checkDataStore itself should not throw, but be defensive
    log.error('healthz.error', { error: err.message });
    return res.json({ status: 'degraded', sweepInFlight: _sweepInFlight, checks: {}, ts: new Date().toISOString() });
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, 'dist') }, (err) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.status(503).send('<h1>503 — App not built</h1><p>Run <code>npm run build</code> first.</p>');
      } else {
        res.status(500).send('<h1>500 — Server error</h1>');
      }
    }
  });
});

// ── Lifecycle scheduler ───────────────────────────────────────────────────────

const LIFECYCLE_INTERVAL_MS =
  parseInt(process.env.LIFECYCLE_INTERVAL_MS ?? String(24 * 60 * 60 * 1000), 10);

function scheduleLifecycleSweep() {
  /** Run one sweep cycle, respecting the in-flight guard. */
  async function runScheduledSweep(label) {
    if (_sweepInFlight) {
      log.warn('lifecycle.scheduler.skipped', { label, reason: 'sweep already in flight' });
      return;
    }
    _sweepInFlight = true;
    try {
      const summary = await runLifecycleSweep(loadIndex, saveIndex, withIndexLock);
      await appendLifecycleRun(summary);
    } catch (err) {
      log.error(`lifecycle.${label}.error`, { error: err.message });
    } finally {
      _sweepInFlight = false;
    }
  }

  // Run once at startup (after a short delay to let the server warm up)
  const startupDelay = process.env.NODE_ENV === 'test' ? 0 : 30_000;
  setTimeout(() => runScheduledSweep('startup'), startupDelay);

  // Then recur on the configured interval
  const timer = setInterval(() => runScheduledSweep('interval'), LIFECYCLE_INTERVAL_MS);

  timer.unref(); // Don't block process exit
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  await ensureDataDirs();
  scheduleLifecycleSweep();

  app.listen(PORT, () => {
    log.info('server.start', { port: PORT, env: process.env.NODE_ENV ?? 'development' });
    if (process.env.NODE_ENV !== 'production') {
      console.log(`mdpage server running at http://localhost:${PORT}`);
      console.log('Development: React app available at http://localhost:5173');
    }
  });
}

start().catch((err) => {
  log.error('server.fatal', { error: err.message, stack: err.stack });
  process.exit(1);
});
