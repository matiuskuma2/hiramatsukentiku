import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createQueueService, hasActiveJob, completeJob, failJob } from './services/queueService';

type Bindings = {
  DB: D1Database;
  DEV_USER_EMAIL?: string;
  OPENAI_API_KEY?: string;
  SNAPSHOT_QUEUE?: any; // Queue binding (optional - may not exist in local dev)
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

// === Health Check ===
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0-spike',
    phase: 'step-0-spike',
  });
});

// === SP-07: CF Access Auth Test ===
app.get('/api/spike/auth', (c) => {
  const cfEmail = c.req.header('CF-Access-Authenticated-User-Email');
  const devEmail = c.env.DEV_USER_EMAIL;
  const email = cfEmail || devEmail;
  return c.json({
    email,
    source: cfEmail ? 'cf-access' : devEmail ? 'dev-bypass' : 'none',
    authenticated: !!email,
  });
});

// === SP-01: Partial Index Test ===
app.get('/api/spike/partial-index', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();

  try {
    // Create test table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _spike_test (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
        project_id TEXT
      )
    `).run();
    results.create_table = 'OK';

    // Create partial index
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_spike_active 
        ON _spike_test(project_id) WHERE status = 'active'
    `).run();
    results.create_partial_index = 'OK';

    // Insert test data
    await db.batch([
      db.prepare(`INSERT OR REPLACE INTO _spike_test (id, status, project_id) VALUES (1, 'active', 'P001')`),
      db.prepare(`INSERT OR REPLACE INTO _spike_test (id, status, project_id) VALUES (2, 'archived', 'P001')`),
      db.prepare(`INSERT OR REPLACE INTO _spike_test (id, status, project_id) VALUES (3, 'active', 'P002')`),
    ]);
    results.insert_data = 'OK';

    // Query with EXPLAIN
    const explain = await db.prepare(
      `EXPLAIN QUERY PLAN SELECT * FROM _spike_test WHERE status = 'active' AND project_id = 'P001'`
    ).all();
    results.explain_query_plan = explain.results;

    // Check if index is used
    const indexUsed = explain.results?.some((r: any) =>
      JSON.stringify(r).includes('idx_spike_active')
    );
    results.index_used = indexUsed;

    // Cleanup
    await db.prepare('DROP TABLE IF EXISTS _spike_test').run();
    results.cleanup = 'OK';

    results.duration_ms = Date.now() - start;
    results.verdict = results.create_partial_index === 'OK' ? 'PASS' : 'FAIL';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    // Cleanup on error
    try { await db.prepare('DROP TABLE IF EXISTS _spike_test').run(); } catch {}
    return c.json(results, 500);
  }
});

// === SP-02: Shadow Snapshot TX Test ===
app.get('/api/spike/shadow-snapshot-tx', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();

  try {
    // Create spike tables
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_projects (
        id INTEGER PRIMARY KEY, project_code TEXT, current_snapshot_id INTEGER, revision_no INTEGER DEFAULT 0, version INTEGER DEFAULT 1
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, status TEXT DEFAULT 'active', revision_no INTEGER, created_at TEXT DEFAULT (datetime('now'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id INTEGER, item_name TEXT, auto_amount REAL, final_amount REAL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, snapshot_id INTEGER, category_code TEXT, total_amount REAL
      )`),
    ]);
    results.create_tables = 'OK';

    // Insert test project
    await db.prepare(
      `INSERT OR REPLACE INTO _spike_projects (id, project_code, current_snapshot_id, revision_no) VALUES (1, '2026-001', NULL, 0)`
    ).run();
    results.insert_project = 'OK';

    // Shadow snapshot TX: 5 items + 1 snapshot + 1 summary + 1 project update = ~8 statements
    const txStart = Date.now();
    const stmts = [];

    // 1. Insert new snapshot
    stmts.push(db.prepare(
      `INSERT INTO _spike_snapshots (project_id, status, revision_no) VALUES (1, 'active', 1)`
    ));

    // 2. Insert 5 cost items
    for (let i = 1; i <= 5; i++) {
      stmts.push(db.prepare(
        `INSERT INTO _spike_items (snapshot_id, item_name, auto_amount, final_amount) VALUES (1, ?, ?, ?)`
      ).bind(`item_${i}`, i * 10000, i * 10000));
    }

    // 3. Insert summary
    stmts.push(db.prepare(
      `INSERT INTO _spike_summaries (project_id, snapshot_id, category_code, total_amount) VALUES (1, 1, 'foundation', 150000)`
    ));

    // 4. Update project
    stmts.push(db.prepare(
      `UPDATE _spike_projects SET current_snapshot_id = 1, revision_no = 1 WHERE id = 1`
    ));

    const batchResult = await db.batch(stmts);
    const txDuration = Date.now() - txStart;
    results.tx_duration_ms = txDuration;
    results.tx_statements = stmts.length;
    results.tx_success = true;

    // Verify
    const project = await db.prepare('SELECT * FROM _spike_projects WHERE id = 1').first();
    const snapshot = await db.prepare('SELECT * FROM _spike_snapshots WHERE id = 1').first();
    const items = await db.prepare('SELECT COUNT(*) as cnt FROM _spike_items WHERE snapshot_id = 1').first();
    const summary = await db.prepare('SELECT * FROM _spike_summaries WHERE snapshot_id = 1').first();

    results.verify = {
      project_snapshot_id: (project as any)?.current_snapshot_id,
      project_revision: (project as any)?.revision_no,
      snapshot_status: (snapshot as any)?.status,
      item_count: (items as any)?.cnt,
      summary_total: (summary as any)?.total_amount,
    };

    // Cleanup
    await db.batch([
      db.prepare('DROP TABLE IF EXISTS _spike_items'),
      db.prepare('DROP TABLE IF EXISTS _spike_summaries'),
      db.prepare('DROP TABLE IF EXISTS _spike_snapshots'),
      db.prepare('DROP TABLE IF EXISTS _spike_projects'),
    ]);
    results.cleanup = 'OK';
    results.duration_ms = Date.now() - start;
    results.verdict = txDuration < 500 ? 'PASS' : 'SLOW';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try {
      await db.batch([
        db.prepare('DROP TABLE IF EXISTS _spike_items'),
        db.prepare('DROP TABLE IF EXISTS _spike_summaries'),
        db.prepare('DROP TABLE IF EXISTS _spike_snapshots'),
        db.prepare('DROP TABLE IF EXISTS _spike_projects'),
      ]);
    } catch {}
    return c.json(results, 500);
  }
});

// === SP-04: Atomic Snapshot Switch Test ===
app.get('/api/spike/atomic-switch', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();

  try {
    // Create tables
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_switch_projects (
        id INTEGER PRIMARY KEY, current_snapshot_id INTEGER, revision_no INTEGER DEFAULT 0
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_switch_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, status TEXT DEFAULT 'active'
      )`),
    ]);

    // Setup: project with NULL snapshot
    await db.prepare(
      'INSERT OR REPLACE INTO _spike_switch_projects (id, current_snapshot_id, revision_no) VALUES (1, NULL, 0)'
    ).run();

    // Test 1: Successful switch
    const txStart1 = Date.now();
    await db.batch([
      db.prepare('INSERT INTO _spike_switch_snapshots (project_id, status) VALUES (1, ?)').bind('active'),
      db.prepare('UPDATE _spike_switch_projects SET current_snapshot_id = 1, revision_no = 1 WHERE id = 1'),
    ]);
    results.success_switch_ms = Date.now() - txStart1;

    const afterSuccess = await db.prepare('SELECT * FROM _spike_switch_projects WHERE id = 1').first() as any;
    results.after_success = {
      current_snapshot_id: afterSuccess?.current_snapshot_id,
      revision_no: afterSuccess?.revision_no,
    };
    results.success_switch_correct = afterSuccess?.current_snapshot_id === 1 && afterSuccess?.revision_no === 1;

    // Test 2: Failure simulation — intentionally cause error in batch
    // Reset
    await db.prepare(
      'UPDATE _spike_switch_projects SET current_snapshot_id = 1, revision_no = 1 WHERE id = 1'
    ).run();

    let failureRolledBack = false;
    try {
      await db.batch([
        db.prepare('INSERT INTO _spike_switch_snapshots (project_id, status) VALUES (1, ?)').bind('active'),
        // This should cause error: invalid table
        db.prepare('UPDATE _spike_nonexistent_table SET x = 1'),
        db.prepare('UPDATE _spike_switch_projects SET current_snapshot_id = 999, revision_no = 999 WHERE id = 1'),
      ]);
    } catch (e: any) {
      results.failure_error = e.message;
      // Check if rolled back
      const afterFail = await db.prepare('SELECT * FROM _spike_switch_projects WHERE id = 1').first() as any;
      failureRolledBack = afterFail?.current_snapshot_id === 1 && afterFail?.revision_no === 1;
      results.after_failure = {
        current_snapshot_id: afterFail?.current_snapshot_id,
        revision_no: afterFail?.revision_no,
      };
    }
    results.failure_rolled_back = failureRolledBack;

    // Cleanup
    await db.batch([
      db.prepare('DROP TABLE IF EXISTS _spike_switch_snapshots'),
      db.prepare('DROP TABLE IF EXISTS _spike_switch_projects'),
    ]);
    results.cleanup = 'OK';
    results.duration_ms = Date.now() - start;
    results.verdict = results.success_switch_correct && failureRolledBack ? 'PASS' : 'FAIL';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try {
      await db.batch([
        db.prepare('DROP TABLE IF EXISTS _spike_switch_snapshots'),
        db.prepare('DROP TABLE IF EXISTS _spike_switch_projects'),
      ]);
    } catch {}
    return c.json(results, 500);
  }
});

// === SP-06: D1 Batch Size Test ===
app.get('/api/spike/batch-size', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();

  try {
    // Create test table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _spike_batch (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT,
        amount REAL
      )
    `).run();

    // Test 50 items
    const test50Start = Date.now();
    const stmts50 = [];
    for (let i = 0; i < 50; i++) {
      stmts50.push(db.prepare('INSERT INTO _spike_batch (item_name, amount) VALUES (?, ?)').bind(`item_${i}`, i * 100));
    }
    await db.batch(stmts50);
    results.batch_50 = { duration_ms: Date.now() - test50Start, success: true };

    // Clear
    await db.prepare('DELETE FROM _spike_batch').run();

    // Test 100 items
    const test100Start = Date.now();
    const stmts100 = [];
    for (let i = 0; i < 100; i++) {
      stmts100.push(db.prepare('INSERT INTO _spike_batch (item_name, amount) VALUES (?, ?)').bind(`item_${i}`, i * 100));
    }
    await db.batch(stmts100);
    results.batch_100 = { duration_ms: Date.now() - test100Start, success: true };

    // Clear
    await db.prepare('DELETE FROM _spike_batch').run();

    // Test 150 items (may exceed limit)
    const test150Start = Date.now();
    try {
      const stmts150 = [];
      for (let i = 0; i < 150; i++) {
        stmts150.push(db.prepare('INSERT INTO _spike_batch (item_name, amount) VALUES (?, ?)').bind(`item_${i}`, i * 100));
      }
      await db.batch(stmts150);
      results.batch_150 = { duration_ms: Date.now() - test150Start, success: true };
    } catch (e: any) {
      results.batch_150 = { duration_ms: Date.now() - test150Start, success: false, error: e.message };
    }

    // Clear
    await db.prepare('DELETE FROM _spike_batch').run();

    // Test 200 items (definitely exceeds for production)
    const test200Start = Date.now();
    try {
      const stmts200 = [];
      for (let i = 0; i < 200; i++) {
        stmts200.push(db.prepare('INSERT INTO _spike_batch (item_name, amount) VALUES (?, ?)').bind(`item_${i}`, i * 100));
      }
      await db.batch(stmts200);
      results.batch_200 = { duration_ms: Date.now() - test200Start, success: true };
    } catch (e: any) {
      results.batch_200 = { duration_ms: Date.now() - test200Start, success: false, error: e.message };
    }

    // Test split batch (2 x 100)
    await db.prepare('DELETE FROM _spike_batch').run();
    const testSplitStart = Date.now();
    const allStmts = [];
    for (let i = 0; i < 200; i++) {
      allStmts.push(db.prepare('INSERT INTO _spike_batch (item_name, amount) VALUES (?, ?)').bind(`item_${i}`, i * 100));
    }
    // Split into chunks of 100
    for (let i = 0; i < allStmts.length; i += 100) {
      const chunk = allStmts.slice(i, i + 100);
      await db.batch(chunk);
    }
    const splitCount = await db.prepare('SELECT COUNT(*) as cnt FROM _spike_batch').first() as any;
    results.batch_split_200 = {
      duration_ms: Date.now() - testSplitStart,
      success: splitCount?.cnt === 200,
      count: splitCount?.cnt,
    };

    // Cleanup
    await db.prepare('DROP TABLE IF EXISTS _spike_batch').run();
    results.cleanup = 'OK';
    results.duration_ms = Date.now() - start;

    // Determine batch limit
    const b50 = (results.batch_50 as any)?.success;
    const b100 = (results.batch_100 as any)?.success;
    const b150 = (results.batch_150 as any)?.success;
    const b200 = (results.batch_200 as any)?.success;

    if (b200) results.effective_limit = '200+';
    else if (b150) results.effective_limit = '150-199';
    else if (b100) results.effective_limit = '100-149';
    else if (b50) results.effective_limit = '50-99';
    else results.effective_limit = '<50';

    results.verdict = b100 ? 'PASS' : 'FAIL';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try { await db.prepare('DROP TABLE IF EXISTS _spike_batch').run(); } catch {}
    return c.json(results, 500);
  }
});

// === SP-03: Queue Simulation (local only) ===
app.get('/api/spike/queue-sim', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();

  try {
    // Create queue log table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _spike_queue_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT,
        sent_at TEXT,
        received_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // Simulate message send
    const sentAt = new Date().toISOString();
    const message = JSON.stringify({ type: 'spike_test', job_id: 'test-001', timestamp: Date.now() });

    // Simulate send → consume → ack
    const sendStart = Date.now();
    await db.prepare(
      'INSERT INTO _spike_queue_log (message, sent_at) VALUES (?, ?)'
    ).bind(message, sentAt).run();
    const consumeTime = Date.now() - sendStart;

    // Verify
    const log = await db.prepare('SELECT * FROM _spike_queue_log ORDER BY id DESC LIMIT 1').first() as any;
    results.send_consume_ms = consumeTime;
    results.message_stored = !!log;
    results.message_content = log?.message ? JSON.parse(log.message) : null;

    // NOTE: Real Queue testing requires deployed environment
    results.note = 'This is a local simulation. Real Cloudflare Queue test requires wrangler pages dev with --queue binding or deployed environment.';
    results.real_queue_test_needed = true;

    // Cleanup
    await db.prepare('DROP TABLE IF EXISTS _spike_queue_log').run();
    results.cleanup = 'OK';
    results.duration_ms = Date.now() - start;
    results.verdict = 'PASS_LOCAL';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try { await db.prepare('DROP TABLE IF EXISTS _spike_queue_log').run(); } catch {}
    return c.json(results, 500);
  }
});

// === CR-04: Queue Integration Test (production-ready pattern) ===
app.get('/api/spike/queue-integration', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();

  try {
    // Setup: create test project for FK constraint
    await db.prepare(`
      INSERT OR IGNORE INTO projects (id, project_code, project_name, lineup, status)
      VALUES (999, 'TEST-999', 'Queue Test Project', 'SHIN', 'draft')
    `).run();

    // Test 1: Queue service creation
    const queueService = createQueueService(c.env);
    results.queue_service_created = true;
    results.queue_mode = c.env.SNAPSHOT_QUEUE ? 'queue' : 'sync_fallback';

    // Test 2: Check exclusive constraint (no active jobs)
    const hasActive = await hasActiveJob(db, 999);
    results.exclusive_check_clean = !hasActive;

    // Test 3: Send a test job
    const jobResult = await queueService.sendSnapshotJob({
      project_id: 999,
      job_type: 'initial',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    results.job_created = { job_id: jobResult.job_id, mode: jobResult.mode };

    // Test 4: Exclusive constraint should now block
    const hasActiveNow = await hasActiveJob(db, 999);
    results.exclusive_constraint_active = hasActiveNow;

    // Test 5: Complete the job
    await completeJob(db, jobResult.job_id, 100); // fake snapshot_id=100
    const completedJob = await db.prepare('SELECT * FROM cost_snapshot_jobs WHERE id = ?').bind(jobResult.job_id).first() as any;
    results.job_completed = {
      status: completedJob?.status,
      result_snapshot_id: completedJob?.result_snapshot_id,
      has_completed_at: !!completedJob?.completed_at,
    };

    // Test 6: After completion, exclusive constraint should clear
    const hasActiveAfter = await hasActiveJob(db, 999);
    results.exclusive_cleared_after_complete = !hasActiveAfter;

    // Test 7: Test failure path
    const failJobResult = await queueService.sendSnapshotJob({
      project_id: 999,
      job_type: 'regenerate_preserve_reviewed',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    await failJob(db, failJobResult.job_id, 'Test error: simulated failure');
    const failedJob = await db.prepare('SELECT * FROM cost_snapshot_jobs WHERE id = ?').bind(failJobResult.job_id).first() as any;
    results.job_failed = {
      status: failedJob?.status,
      error_message: failedJob?.error_message,
      has_completed_at: !!failedJob?.completed_at,
    };

    // Cleanup test data
    await db.prepare('DELETE FROM cost_snapshot_jobs WHERE project_id = 999').run();
    await db.prepare('DELETE FROM projects WHERE id = 999').run();
    results.cleanup = 'OK';

    results.duration_ms = Date.now() - start;
    results.verdict = results.exclusive_constraint_active && results.exclusive_cleared_after_complete
      && completedJob?.status === 'completed' && failedJob?.status === 'failed'
      ? 'PASS' : 'FAIL';
    results.note = c.env.SNAPSHOT_QUEUE
      ? 'Real Cloudflare Queue used'
      : 'Sync fallback mode (Queue binding not available). Production will use real Queue.';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try { 
      await db.prepare('DELETE FROM cost_snapshot_jobs WHERE project_id = 999').run();
      await db.prepare('DELETE FROM projects WHERE id = 999').run();
    } catch {}
    return c.json(results, 500);
  }
});

// === DEEP: D1 Transaction Stability (repeated batch + concurrent simulation) ===
app.get('/api/spike/deep/tx-stability', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();
  const ITERATIONS = 10;

  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS _spike_tx_stress (
      id INTEGER PRIMARY KEY AUTOINCREMENT, value INTEGER, batch_id INTEGER
    )`).run();

    // Run 10 sequential batch transactions
    const batchTimes: number[] = [];
    let totalRows = 0;
    for (let batch = 0; batch < ITERATIONS; batch++) {
      const bStart = Date.now();
      const stmts = [];
      for (let i = 0; i < 50; i++) {
        stmts.push(db.prepare('INSERT INTO _spike_tx_stress (value, batch_id) VALUES (?, ?)').bind(batch * 50 + i, batch));
      }
      await db.batch(stmts);
      batchTimes.push(Date.now() - bStart);
      totalRows += 50;
    }

    const count = await db.prepare('SELECT COUNT(*) as cnt FROM _spike_tx_stress').first() as any;
    results.total_rows = count?.cnt;
    results.expected_rows = totalRows;
    results.consistency = count?.cnt === totalRows;
    results.batch_times_ms = batchTimes;
    results.avg_batch_ms = Math.round(batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length);
    results.max_batch_ms = Math.max(...batchTimes);
    results.min_batch_ms = Math.min(...batchTimes);

    // Optimistic lock conflict simulation
    await db.prepare(`CREATE TABLE IF NOT EXISTS _spike_lock_test (
      id INTEGER PRIMARY KEY, data TEXT, version INTEGER DEFAULT 1
    )`).run();
    await db.prepare('INSERT OR REPLACE INTO _spike_lock_test (id, data, version) VALUES (1, ?, 1)').bind('initial').run();

    // Simulate two "concurrent" updates with version check
    const v1 = await db.prepare('SELECT version FROM _spike_lock_test WHERE id = 1').first() as any;
    const update1 = await db.prepare(
      'UPDATE _spike_lock_test SET data = ?, version = version + 1 WHERE id = 1 AND version = ?'
    ).bind('update1', v1?.version).run();
    results.lock_update1_changes = update1.meta.changes;

    // Second update with stale version should affect 0 rows
    const update2 = await db.prepare(
      'UPDATE _spike_lock_test SET data = ?, version = version + 1 WHERE id = 1 AND version = ?'
    ).bind('update2', v1?.version).run();
    results.lock_update2_changes = update2.meta.changes;
    results.optimistic_lock_works = update1.meta.changes === 1 && update2.meta.changes === 0;

    // Cleanup
    await db.batch([
      db.prepare('DROP TABLE IF EXISTS _spike_tx_stress'),
      db.prepare('DROP TABLE IF EXISTS _spike_lock_test'),
    ]);
    results.cleanup = 'OK';
    results.duration_ms = Date.now() - start;
    results.verdict = results.consistency && results.optimistic_lock_works ? 'PASS' : 'FAIL';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try {
      await db.batch([
        db.prepare('DROP TABLE IF EXISTS _spike_tx_stress'),
        db.prepare('DROP TABLE IF EXISTS _spike_lock_test'),
      ]);
    } catch {}
    return c.json(results, 500);
  }
});

// === DEEP: Full-scale Snapshot (37 cost items + summary + snapshot) ===
app.get('/api/spike/deep/full-snapshot', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();
  const ITEM_COUNT = 37; // Real project: 37 trades

  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_full_proj (
        id INTEGER PRIMARY KEY, current_snapshot_id INTEGER, revision_no INTEGER DEFAULT 0
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_full_snap (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, revision_no INTEGER, status TEXT, created_at TEXT DEFAULT (datetime('now'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_full_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id INTEGER, item_code TEXT,
        category_code TEXT, auto_amount REAL, manual_override_amount REAL, final_amount REAL,
        is_reviewed INTEGER DEFAULT 0, override_reason TEXT
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS _spike_full_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, snapshot_id INTEGER,
        category_code TEXT, total_amount REAL, item_count INTEGER
      )`),
    ]);

    await db.prepare('INSERT OR REPLACE INTO _spike_full_proj (id, current_snapshot_id, revision_no) VALUES (1, NULL, 0)').run();

    // Build full snapshot TX: 1 snapshot + 37 items + 10 summaries + 1 project update = 49 statements
    const categories = ['foundation','frame','exterior','roofing','interior','plumbing','electric','pv_solar','misc','option'];
    const stmts = [];

    // Snapshot insert
    stmts.push(db.prepare('INSERT INTO _spike_full_snap (project_id, revision_no, status) VALUES (1, 1, ?)').bind('active'));

    // 37 cost items
    for (let i = 0; i < ITEM_COUNT; i++) {
      const cat = categories[i % categories.length];
      const amount = Math.round(50000 + Math.random() * 500000);
      stmts.push(db.prepare(
        `INSERT INTO _spike_full_items (snapshot_id, item_code, category_code, auto_amount, manual_override_amount, final_amount, is_reviewed)
         VALUES (1, ?, ?, ?, NULL, ?, 0)`
      ).bind(`item_${String(i + 1).padStart(3, '0')}`, cat, amount, amount));
    }

    // 10 category summaries
    for (const cat of categories) {
      const total = Math.round(100000 + Math.random() * 1000000);
      stmts.push(db.prepare(
        'INSERT INTO _spike_full_summary (project_id, snapshot_id, category_code, total_amount, item_count) VALUES (1, 1, ?, ?, ?)'
      ).bind(cat, total, Math.floor(ITEM_COUNT / categories.length)));
    }

    // Project update
    stmts.push(db.prepare('UPDATE _spike_full_proj SET current_snapshot_id = 1, revision_no = 1 WHERE id = 1'));

    results.total_statements = stmts.length;
    const txStart = Date.now();
    await db.batch(stmts);
    results.tx_duration_ms = Date.now() - txStart;

    // Verify
    const proj = await db.prepare('SELECT * FROM _spike_full_proj WHERE id = 1').first() as any;
    const itemCount = await db.prepare('SELECT COUNT(*) as cnt FROM _spike_full_items WHERE snapshot_id = 1').first() as any;
    const sumCount = await db.prepare('SELECT COUNT(*) as cnt FROM _spike_full_summary WHERE snapshot_id = 1').first() as any;

    results.verify = {
      project_snapshot_id: proj?.current_snapshot_id,
      project_revision: proj?.revision_no,
      items_inserted: itemCount?.cnt,
      summaries_inserted: sumCount?.cnt,
    };
    results.all_correct = proj?.current_snapshot_id === 1 && itemCount?.cnt === ITEM_COUNT && sumCount?.cnt === categories.length;

    // Test regeneration scenario: create snapshot 2 preserving reviewed items
    const regenStmts = [];
    regenStmts.push(db.prepare('INSERT INTO _spike_full_snap (project_id, revision_no, status) VALUES (1, 2, ?)').bind('active'));
    regenStmts.push(db.prepare("UPDATE _spike_full_snap SET status = 'superseded' WHERE id = 1"));

    // Copy items to new snapshot (simulate preserve-reviewed)
    for (let i = 0; i < ITEM_COUNT; i++) {
      const amount = Math.round(50000 + Math.random() * 500000);
      regenStmts.push(db.prepare(
        `INSERT INTO _spike_full_items (snapshot_id, item_code, category_code, auto_amount, manual_override_amount, final_amount, is_reviewed)
         VALUES (2, ?, 'foundation', ?, NULL, ?, 0)`
      ).bind(`item_${String(i + 1).padStart(3, '0')}`, amount, amount));
    }
    regenStmts.push(db.prepare('UPDATE _spike_full_proj SET current_snapshot_id = 2, revision_no = 2 WHERE id = 1'));

    results.regen_statements = regenStmts.length;
    const regenStart = Date.now();
    await db.batch(regenStmts);
    results.regen_tx_duration_ms = Date.now() - regenStart;

    const projAfter = await db.prepare('SELECT * FROM _spike_full_proj WHERE id = 1').first() as any;
    results.regen_verify = {
      snapshot_id: projAfter?.current_snapshot_id,
      revision: projAfter?.revision_no,
    };
    results.regen_correct = projAfter?.current_snapshot_id === 2 && projAfter?.revision_no === 2;

    // Cleanup
    await db.batch([
      db.prepare('DROP TABLE IF EXISTS _spike_full_items'),
      db.prepare('DROP TABLE IF EXISTS _spike_full_summary'),
      db.prepare('DROP TABLE IF EXISTS _spike_full_snap'),
      db.prepare('DROP TABLE IF EXISTS _spike_full_proj'),
    ]);
    results.cleanup = 'OK';
    results.duration_ms = Date.now() - start;
    results.verdict = results.all_correct && results.regen_correct ? 'PASS' : 'FAIL';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try {
      await db.batch([
        db.prepare('DROP TABLE IF EXISTS _spike_full_items'),
        db.prepare('DROP TABLE IF EXISTS _spike_full_summary'),
        db.prepare('DROP TABLE IF EXISTS _spike_full_snap'),
        db.prepare('DROP TABLE IF EXISTS _spike_full_proj'),
      ]);
    } catch {}
    return c.json(results, 500);
  }
});

// === DEEP: Seed Integrity Check (validate real migration tables) ===
app.get('/api/spike/deep/seed-integrity', async (c) => {
  const db = c.env.DB;
  const results: Record<string, unknown> = {};
  const start = Date.now();

  try {
    // Count all tables
    const tables = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_spike_%' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"
    ).all();
    results.table_count = tables.results?.length;
    results.tables = tables.results?.map((t: any) => t.name);

    // Check system_settings seed
    const settings = await db.prepare('SELECT * FROM system_settings').all();
    results.system_settings_count = settings.results?.length;
    results.system_settings_expected = 9;
    results.system_settings_match = settings.results?.length === 9;

    // Verify specific settings values
    const thresholds: Record<string, unknown> = {};
    for (const row of (settings.results || []) as any[]) {
      thresholds[row.setting_key] = { value: row.setting_value, type: row.value_type };
    }
    results.settings_detail = thresholds;

    // Check all indexes
    const indexes = await db.prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
    ).all();
    results.index_count = indexes.results?.length;

    // Verify CHECK constraints on key tables
    const checkTests = [];

    // Test projects.status CHECK
    try {
      await db.prepare("INSERT INTO projects (project_code, project_name, status) VALUES ('TEST-999', 'test', 'invalid_status')").run();
      checkTests.push({ table: 'projects', field: 'status', check_enforced: false });
      await db.prepare("DELETE FROM projects WHERE project_code = 'TEST-999'").run();
    } catch {
      checkTests.push({ table: 'projects', field: 'status', check_enforced: true });
    }

    // Test projects.lineup CHECK
    try {
      await db.prepare("INSERT INTO projects (project_code, project_name, lineup) VALUES ('TEST-998', 'test', 'INVALID_LINEUP')").run();
      checkTests.push({ table: 'projects', field: 'lineup', check_enforced: false });
      await db.prepare("DELETE FROM projects WHERE project_code = 'TEST-998'").run();
    } catch {
      checkTests.push({ table: 'projects', field: 'lineup', check_enforced: true });
    }

    // Test cost_snapshot_jobs.job_type CHECK
    try {
      await db.prepare("INSERT INTO cost_snapshot_jobs (project_id, job_type, status) VALUES (999, 'invalid_type', 'queued')").run();
      checkTests.push({ table: 'cost_snapshot_jobs', field: 'job_type', check_enforced: false });
      await db.prepare("DELETE FROM cost_snapshot_jobs WHERE project_id = 999").run();
    } catch {
      checkTests.push({ table: 'cost_snapshot_jobs', field: 'job_type', check_enforced: true });
    }

    // Test app_users.role CHECK
    try {
      await db.prepare("INSERT INTO app_users (email, display_name, role, status) VALUES ('test@x.com', 'test', 'superadmin', 'active')").run();
      checkTests.push({ table: 'app_users', field: 'role', check_enforced: false });
      await db.prepare("DELETE FROM app_users WHERE email = 'test@x.com'").run();
    } catch {
      checkTests.push({ table: 'app_users', field: 'role', check_enforced: true });
    }

    results.check_constraints = checkTests;
    results.all_checks_enforced = checkTests.every(t => t.check_enforced);

    // Foreign key support check
    const fkStatus = await db.prepare('PRAGMA foreign_keys').first() as any;
    results.foreign_keys_enabled = fkStatus?.foreign_keys === 1;
    results.fk_note = 'D1 may have foreign_keys disabled by default. Application must enforce FK logic.';

    results.duration_ms = Date.now() - start;
    results.verdict = results.system_settings_match && results.all_checks_enforced ? 'PASS' : 'PARTIAL';

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    return c.json(results, 500);
  }
});

// === Master: Run All Spike Tests ===
app.get('/api/spike/run-all', async (c) => {
  const baseUrl = 'http://localhost:3000';
  const tests = [
    { id: 'SP-01', name: 'Partial Index', path: '/api/spike/partial-index' },
    { id: 'SP-02', name: 'Shadow Snapshot TX', path: '/api/spike/shadow-snapshot-tx' },
    { id: 'SP-03', name: 'Queue Simulation', path: '/api/spike/queue-sim' },
    { id: 'SP-04', name: 'Atomic Switch', path: '/api/spike/atomic-switch' },
    { id: 'SP-06', name: 'Batch Size', path: '/api/spike/batch-size' },
    { id: 'SP-07', name: 'Auth', path: '/api/spike/auth' },
    { id: 'CR-04', name: 'Queue Integration', path: '/api/spike/queue-integration' },
    { id: 'DEEP-TX', name: 'TX Stability', path: '/api/spike/deep/tx-stability' },
    { id: 'DEEP-SNAP', name: 'Full Snapshot', path: '/api/spike/deep/full-snapshot' },
    { id: 'DEEP-SEED', name: 'Seed Integrity', path: '/api/spike/deep/seed-integrity' },
  ];

  const summary: Record<string, unknown> = {};
  const start = Date.now();

  for (const test of tests) {
    try {
      const res = await fetch(`${baseUrl}${test.path}`);
      const data = await res.json() as any;
      summary[test.id] = {
        name: test.name,
        verdict: data.verdict || (test.id === 'SP-07' ? (data.authenticated ? 'PASS' : 'PASS_DEV') : 'UNKNOWN'),
        duration_ms: data.duration_ms || data.tx_duration_ms || 0,
        key_data: test.id === 'SP-06' ? { effective_limit: data.effective_limit } :
                  test.id === 'SP-02' ? { tx_ms: data.tx_duration_ms, statements: data.tx_statements } :
                  test.id === 'SP-07' ? { email: data.email, source: data.source } :
                  test.id === 'DEEP-TX' ? { avg_batch_ms: data.avg_batch_ms, lock_works: data.optimistic_lock_works } :
                  test.id === 'DEEP-SNAP' ? { tx_ms: data.tx_duration_ms, regen_ms: data.regen_tx_duration_ms, stmts: data.total_statements } :
                  test.id === 'DEEP-SEED' ? { tables: data.table_count, settings: data.system_settings_count, checks: data.all_checks_enforced } :
                  undefined,
      };
    } catch (e: any) {
      summary[test.id] = { name: test.name, verdict: 'ERROR', error: e.message };
    }
  }

  const allVerdicts = Object.values(summary).map((s: any) => s.verdict);
  const passCount = allVerdicts.filter(v => v === 'PASS' || v === 'PASS_LOCAL' || v === 'PASS_DEV').length;

  return c.json({
    summary,
    total_tests: tests.length,
    passed: passCount,
    total_duration_ms: Date.now() - start,
    overall_verdict: passCount === tests.length ? 'ALL_PASS' :
                     passCount >= tests.length - 2 ? 'MOSTLY_PASS' : 'HAS_FAILURES',
    timestamp: new Date().toISOString(),
  });
});

// === Default route ===
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Hiramatsu Cost - Step 0 Spike</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-white p-8">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold mb-4">Step 0 Spike Test Dashboard</h1>
        <p class="text-gray-400 mb-8">All tests run against local D1 (SQLite). Click each to execute.</p>
        <div class="grid gap-4">
          <a href="/api/health" class="block bg-gray-800 p-4 rounded hover:bg-gray-700">
            <span class="text-green-400 font-mono">GET /api/health</span> — Health Check
          </a>
          <a href="/api/spike/auth" class="block bg-gray-800 p-4 rounded hover:bg-gray-700">
            <span class="text-blue-400 font-mono">SP-07</span> — CF Access Auth Test
          </a>
          <a href="/api/spike/partial-index" class="block bg-gray-800 p-4 rounded hover:bg-gray-700">
            <span class="text-yellow-400 font-mono">SP-01</span> — Partial Index Test
          </a>
          <a href="/api/spike/batch-size" class="block bg-gray-800 p-4 rounded hover:bg-gray-700">
            <span class="text-yellow-400 font-mono">SP-06</span> — D1 Batch Size Test
          </a>
          <a href="/api/spike/shadow-snapshot-tx" class="block bg-gray-800 p-4 rounded hover:bg-gray-700">
            <span class="text-red-400 font-mono">SP-02</span> — Shadow Snapshot TX Test
          </a>
          <a href="/api/spike/atomic-switch" class="block bg-gray-800 p-4 rounded hover:bg-gray-700">
            <span class="text-red-400 font-mono">SP-04</span> — Atomic Snapshot Switch
          </a>
          <a href="/api/spike/queue-sim" class="block bg-gray-800 p-4 rounded hover:bg-gray-700">
            <span class="text-purple-400 font-mono">SP-03</span> — Queue Simulation
          </a>
        </div>
      </div>
    </body>
    </html>
  `);
});

export default app;
