/**
 * server.js — mdpage Express server (Phase 1)
 *
 * API surface:
 *   POST /api/publish                        — publish a new article
 *   GET  /api/articles/:slug                 — read article + metadata
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
  render,
  renderContent,
  extractTitle,
  generateSlug,
  extractDescription,
  estimateReadingTime,
} from './lib/markdown.js';
import { normalizeSlugBase, resolveSlug } from './lib/slug.js';
import { recordView, getUniqueViewCount, getViewData } from './lib/views.js';
import { evaluateArticle, runLifecycleSweep, config as lifecycleConfig } from './lib/lifecycle.js';
import { publishRateLimit, viewRateLimit, honeypot, rateLimitConfig } from './lib/ratelimit.js';
import log from './lib/logger.js';

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
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
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

    // Expired posts are no longer publicly served
    if (article.status === 'expired') {
      return res.status(410).json({
        error: 'This article has expired and is no longer available.',
        status: 'expired',
        slug,
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
    });

  } catch (err) {
    log.error('article.get.error', { error: err.message });
    return res.status(500).json({ error: 'Error loading article' });
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
app.get('/api/internal/lifecycle/:slug', async (req, res) => {
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
app.post('/api/internal/lifecycle/run', async (req, res) => {
  try {
    const summary = await runLifecycleSweep(loadIndex, saveIndex, withIndexLock);
    return res.json(summary);
  } catch (err) {
    log.error('lifecycle.run.error', { error: err.message });
    return res.status(500).json({ error: 'Lifecycle sweep failed', details: err.message });
  }
});

/**
 * GET /api/internal/config
 *
 * Expose current runtime configuration for debugging.
 */
app.get('/api/internal/config', (_req, res) => {
  return res.json({
    lifecycle: lifecycleConfig,
    rateLimit: rateLimitConfig,
    env:       process.env.NODE_ENV ?? 'development',
  });
});

/**
 * GET /healthz
 *
 * Lightweight liveness probe for Docker / load balancers.
 * Does not require the frontend to be built.
 */
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
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
  // Run once at startup (after a short delay to let the server warm up)
  const startupDelay = process.env.NODE_ENV === 'test' ? 0 : 30_000;
  setTimeout(async () => {
    try {
      await runLifecycleSweep(loadIndex, saveIndex, withIndexLock);
    } catch (err) {
      log.error('lifecycle.startup.error', { error: err.message });
    }
  }, startupDelay);

  // Then recur on the configured interval
  const timer = setInterval(async () => {
    try {
      await runLifecycleSweep(loadIndex, saveIndex, withIndexLock);
    } catch (err) {
      log.error('lifecycle.interval.error', { error: err.message });
    }
  }, LIFECYCLE_INTERVAL_MS);

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
