/**
 * tests/unit/healthz.test.js
 *
 * Unit tests for lib/healthz.js → checkDataStore()
 *
 * Coverage:
 *   [HZ-01] Returns 'ok' when all files are present and valid
 *   [HZ-02] Returns 'degraded' when data directory is missing
 *   [HZ-03] Returns 'degraded' when index.json is missing
 *   [HZ-04] Returns 'degraded' when index.json contains corrupt JSON
 *   [HZ-05] Returns 'degraded' when index.json root value is not an object
 *   [HZ-06] lifecycleRuns missing is non-fatal (status stays 'ok')
 *   [HZ-07] lifecycleRuns corrupt is non-fatal (status stays 'ok')
 *   [HZ-08] checks object always has all three keys
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { checkDataStore } from '../../lib/healthz.js';

// ── Temp-dir helpers ──────────────────────────────────────────────────────────

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mdpage-hz-'));
}

/** Write valid default files into a tmp data dir. */
async function seedGoodDir(dir) {
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({}));
  await fs.writeFile(path.join(dir, 'lifecycle-runs.json'), JSON.stringify([]));
}

// ── [HZ-01] All files present + valid ────────────────────────────────────────

describe('[HZ-01] All files present and valid', () => {
  let dir;
  before(async () => { dir = await makeTmpDir(); await seedGoodDir(dir); });
  after(async ()  => { await fs.rm(dir, { recursive: true, force: true }); });

  test('status is ok', async () => {
    const { status } = await checkDataStore(dir);
    assert.equal(status, 'ok');
  });

  test('all checks are ok', async () => {
    const { checks } = await checkDataStore(dir);
    assert.equal(checks.dataDir,       'ok');
    assert.equal(checks.index,         'ok');
    assert.equal(checks.lifecycleRuns, 'ok');
  });
});

// ── [HZ-02] Data directory missing ───────────────────────────────────────────

describe('[HZ-02] Data directory does not exist', () => {
  test('status is degraded, dataDir check is error', async () => {
    const { status, checks } = await checkDataStore('/tmp/__mdpage_nonexistent_dir__');
    assert.equal(status, 'degraded');
    assert.equal(checks.dataDir, 'error');
  });
});

// ── [HZ-03] index.json missing ────────────────────────────────────────────────

describe('[HZ-03] index.json is missing', () => {
  let dir;
  before(async () => {
    dir = await makeTmpDir();
    // Only create lifecycle-runs; omit index.json
    await fs.writeFile(path.join(dir, 'lifecycle-runs.json'), '[]');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test('status is degraded', async () => {
    const { status } = await checkDataStore(dir);
    assert.equal(status, 'degraded');
  });

  test('index check is "missing"', async () => {
    const { checks } = await checkDataStore(dir);
    assert.equal(checks.index, 'missing');
  });
});

// ── [HZ-04] index.json contains corrupt JSON ─────────────────────────────────

describe('[HZ-04] index.json contains corrupt JSON', () => {
  let dir;
  before(async () => {
    dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'index.json'), '{bad json!!!');
    await fs.writeFile(path.join(dir, 'lifecycle-runs.json'), '[]');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test('status is degraded', async () => {
    const { status } = await checkDataStore(dir);
    assert.equal(status, 'degraded');
  });

  test('index check is "corrupt"', async () => {
    const { checks } = await checkDataStore(dir);
    assert.equal(checks.index, 'corrupt');
  });
});

// ── [HZ-05] index.json root is not an object ─────────────────────────────────

describe('[HZ-05] index.json root value is not an object', () => {
  let dir;
  before(async () => {
    dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'lifecycle-runs.json'), '[]');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  for (const [label, value] of [
    ['array',  '[]'],
    ['null',   'null'],
    ['number', '42'],
    ['string', '"hello"'],
  ]) {
    test(`${label} root → degraded + corrupt`, async () => {
      await fs.writeFile(path.join(dir, 'index.json'), value);
      const { status, checks } = await checkDataStore(dir);
      assert.equal(status, 'degraded');
      assert.equal(checks.index, 'corrupt');
    });
  }
});

// ── [HZ-06] lifecycle-runs.json missing is non-fatal ─────────────────────────

describe('[HZ-06] lifecycle-runs.json missing is non-fatal', () => {
  let dir;
  before(async () => {
    dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'index.json'), '{}');
    // Do NOT create lifecycle-runs.json
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test('status is ok even with missing lifecycle-runs.json', async () => {
    const { status } = await checkDataStore(dir);
    assert.equal(status, 'ok');
  });

  test('lifecycleRuns check is "missing"', async () => {
    const { checks } = await checkDataStore(dir);
    assert.equal(checks.lifecycleRuns, 'missing');
  });
});

// ── [HZ-07] lifecycle-runs.json corrupt is non-fatal ─────────────────────────

describe('[HZ-07] lifecycle-runs.json corrupt is non-fatal', () => {
  let dir;
  before(async () => {
    dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'index.json'), '{}');
    await fs.writeFile(path.join(dir, 'lifecycle-runs.json'), '{not an array}');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test('status is ok despite corrupt lifecycle-runs.json', async () => {
    const { status } = await checkDataStore(dir);
    assert.equal(status, 'ok');
  });

  test('lifecycleRuns check is "corrupt"', async () => {
    const { checks } = await checkDataStore(dir);
    assert.equal(checks.lifecycleRuns, 'corrupt');
  });
});

// ── [HZ-08] checks object always has all three keys ──────────────────────────

describe('[HZ-08] checks object always has exactly the expected keys', () => {
  let dir;
  before(async () => { dir = await makeTmpDir(); await seedGoodDir(dir); });
  after(async ()  => { await fs.rm(dir, { recursive: true, force: true }); });

  test('checks has dataDir, index, lifecycleRuns keys', async () => {
    const { checks } = await checkDataStore(dir);
    assert.ok(Object.prototype.hasOwnProperty.call(checks, 'dataDir'));
    assert.ok(Object.prototype.hasOwnProperty.call(checks, 'index'));
    assert.ok(Object.prototype.hasOwnProperty.call(checks, 'lifecycleRuns'));
    assert.equal(Object.keys(checks).length, 3);
  });
});
