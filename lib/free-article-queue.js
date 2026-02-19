/**
 * lib/free-article-queue.js
 *
 * Global in-memory queue for free article creation.
 *
 * Goals:
 * - Serialize expensive publish work.
 * - Enforce a global cadence (default: 1 create / minute).
 * - Prevent one noisy client from stampeding the server.
 */

const toInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const freeArticleQueueConfig = {
  minIntervalMs: toInt(process.env.FREE_ARTICLE_MIN_INTERVAL_MS, 60_000),
  maxQueueSize:  toInt(process.env.FREE_ARTICLE_QUEUE_MAX, 200),
  jobTtlMs:      toInt(process.env.FREE_ARTICLE_JOB_TTL_MS, 6 * 60 * 60 * 1000),
};

const state = {
  queue: [],
  jobs: new Map(),
  nextSlotAt: 0,
  processing: false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pruneOldJobs() {
  const cutoff = Date.now() - freeArticleQueueConfig.jobTtlMs;
  for (const [id, job] of state.jobs.entries()) {
    if ((job.finishedAt ?? 0) > 0 && job.finishedAt < cutoff) {
      state.jobs.delete(id);
    }
  }
}

function toPublicJob(job) {
  if (!job) return null;
  const now = Date.now();
  const etaMs = job.status === 'queued'
    ? Math.max(0, job.scheduledAt - now)
    : 0;

  return {
    id:          job.id,
    status:      job.status,
    queuedAt:    new Date(job.queuedAt).toISOString(),
    scheduledAt: new Date(job.scheduledAt).toISOString(),
    startedAt:   job.startedAt ? new Date(job.startedAt).toISOString() : null,
    finishedAt:  job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    etaSeconds:  Math.ceil(etaMs / 1000),
    result:      job.status === 'done' ? job.result : undefined,
    error:       job.status === 'failed' ? job.error : undefined,
  };
}

async function processQueue() {
  if (state.processing) return;
  state.processing = true;

  try {
    while (state.queue.length > 0) {
      const job = state.queue[0];
      const waitMs = Math.max(0, job.scheduledAt - Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      state.queue.shift();
      job.status = 'processing';
      job.startedAt = Date.now();

      try {
        const result = await job.run();
        job.status = 'done';
        job.result = result;
      } catch (err) {
        job.status = 'failed';
        job.error = err?.message ?? 'Queue job failed';
      } finally {
        job.finishedAt = Date.now();
      }
    }
  } finally {
    state.processing = false;
    pruneOldJobs();
  }
}

export function enqueueFreeArticle(run) {
  pruneOldJobs();

  if (state.queue.length >= freeArticleQueueConfig.maxQueueSize) {
    const err = new Error('Free article queue is full. Please retry later.');
    err.code = 'QUEUE_FULL';
    throw err;
  }

  const now = Date.now();
  const scheduledAt = Math.max(now, state.nextSlotAt);
  state.nextSlotAt = scheduledAt + freeArticleQueueConfig.minIntervalMs;

  const id = `freejob_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    queuedAt: now,
    scheduledAt,
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    run,
  };

  state.queue.push(job);
  state.jobs.set(id, job);
  processQueue();

  return {
    jobId: id,
    position: state.queue.findIndex((x) => x.id === id) + 1,
    etaSeconds: Math.ceil(Math.max(0, scheduledAt - now) / 1000),
    scheduledAt: new Date(scheduledAt).toISOString(),
  };
}

export function getFreeArticleJob(jobId) {
  return toPublicJob(state.jobs.get(jobId));
}

/**
 * Wait up to maxMs for a job to reach a terminal state (done|failed).
 * Polls every pollIntervalMs milliseconds.
 *
 * Returns the public job object when settled, or null on timeout.
 *
 * @param {string} jobId
 * @param {object} [opts]
 * @param {number} [opts.maxMs=30000]
 * @param {number} [opts.pollIntervalMs=50]
 */
export async function waitForFreeArticleJob(jobId, { maxMs = 30_000, pollIntervalMs = 50 } = {}) {
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const job = state.jobs.get(jobId);
    if (!job) return null;
    if (job.status === 'done' || job.status === 'failed') {
      return toPublicJob(job);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  // Timed out — return current snapshot (still queued/processing)
  const job = state.jobs.get(jobId);
  return job ? toPublicJob(job) : null;
}

export function freeArticleQueueStats() {
  return {
    minIntervalMs: freeArticleQueueConfig.minIntervalMs,
    maxQueueSize: freeArticleQueueConfig.maxQueueSize,
    queued: state.queue.length,
    processing: state.processing,
    nextSlotAt: state.nextSlotAt ? new Date(state.nextSlotAt).toISOString() : null,
  };
}
