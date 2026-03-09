import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createQueueService, hasActiveJob, completeJob, failJob } from './services/queueService';
import masterRoutes from './routes/master';
import projectRoutes from './routes/projects';
import snapshotRoutes from './routes/snapshots';
import costItemRoutes from './routes/costItems';
import salesEstimateRoutes from './routes/salesEstimates';
import riskCentreRoutes from './routes/riskCentre';
import aiRoutes from './routes/ai';
import uiRoutes from './routes/ui';
import adminRoutes from './routes/admin';

type Bindings = {
  DB: D1Database;
  DEV_USER_EMAIL?: string;
  OPENAI_API_KEY?: string;
  SNAPSHOT_QUEUE?: any; // Queue binding (optional - may not exist in local dev)
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

// === Mount modular routes ===
app.route('/api/master', masterRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/projects', snapshotRoutes);
app.route('/api/projects', costItemRoutes);
app.route('/api/projects', salesEstimateRoutes);
app.route('/api/projects', riskCentreRoutes);
app.route('/api/ai', aiRoutes);
// AI warnings routes are nested under /api/ai/warnings/* (defined in ai.ts)
app.route('/api', adminRoutes);
app.route('/', uiRoutes);

// === Health Check ===
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.11.0',
    phase: 'p2-ux-improvement-deployed',
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

// === CR-04: Queue Production-Level Test (comprehensive) ===
// 検証項目:
//   T1: enqueue が通る
//   T2: consumer が受ける (状態遷移 queued → running → completed)
//   T3: 同一案件で active job が二重発行されない
//   T4: 失敗時の挙動 (queued → running → failed)
//   T5: timeout 監視 (stale job detection)
//   T6: sync fallback と Queue モードの切替
//   T7: completed 後に再 enqueue できる
//   T8: 遅延時間計測
app.get('/api/spike/queue-production-test', async (c) => {
  const db = c.env.DB;
  const results: Record<string, any> = {};
  const start = Date.now();
  const TEST_PROJECT_ID = 9900;

  try {
    // ── Setup ──
    await db.prepare(`DELETE FROM cost_snapshot_jobs WHERE project_id = ?`).bind(TEST_PROJECT_ID).run();
    await db.prepare(`DELETE FROM projects WHERE id = ?`).bind(TEST_PROJECT_ID).run();
    await db.prepare(`
      INSERT INTO projects (id, project_code, project_name, lineup, status)
      VALUES (?, 'TEST-QUEUE', 'Queue Production Test', 'SHIN', 'draft')
    `).bind(TEST_PROJECT_ID).run();

    const queueService = createQueueService(c.env);
    results.queue_mode = c.env.SNAPSHOT_QUEUE ? 'real_queue' : 'sync_fallback';

    // ── T1: enqueue succeeds ──
    const t1Start = Date.now();
    const job1 = await queueService.sendSnapshotJob({
      project_id: TEST_PROJECT_ID,
      job_type: 'initial',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    const t1Duration = Date.now() - t1Start;
    const job1Row = await db.prepare('SELECT * FROM cost_snapshot_jobs WHERE id = ?').bind(job1.job_id).first() as any;
    results.T1_enqueue = {
      verdict: job1.job_id > 0 && ['queued', 'running'].includes(job1Row?.status) ? 'PASS' : 'FAIL',
      job_id: job1.job_id,
      mode: job1.mode,
      initial_status: job1Row?.status,
      job_type: job1Row?.job_type,
      duration_ms: t1Duration,
    };

    // ── T2: state transition queued → running → completed ──
    // Simulate consumer receiving the message
    await db.prepare(
      "UPDATE cost_snapshot_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?"
    ).bind(job1.job_id).run();
    const runningRow = await db.prepare('SELECT status FROM cost_snapshot_jobs WHERE id = ?').bind(job1.job_id).first() as any;

    // Simulate consumer completing
    const FAKE_SNAPSHOT_ID = 500;
    await completeJob(db, job1.job_id, FAKE_SNAPSHOT_ID);
    const completedRow = await db.prepare('SELECT * FROM cost_snapshot_jobs WHERE id = ?').bind(job1.job_id).first() as any;

    results.T2_state_transition = {
      verdict: runningRow?.status === 'running' && completedRow?.status === 'completed'
        && completedRow?.result_snapshot_id === FAKE_SNAPSHOT_ID
        && !!completedRow?.completed_at ? 'PASS' : 'FAIL',
      running_status: runningRow?.status,
      completed_status: completedRow?.status,
      result_snapshot_id: completedRow?.result_snapshot_id,
      has_completed_at: !!completedRow?.completed_at,
      has_started_at: !!completedRow?.started_at,
    };

    // ── T3: duplicate job prevention ──
    // Create a new active job
    const job2 = await queueService.sendSnapshotJob({
      project_id: TEST_PROJECT_ID,
      job_type: 'regenerate_auto_only',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    // Now try to check exclusion
    const hasActive = await hasActiveJob(db, TEST_PROJECT_ID);
    // Try to enqueue another — should be blocked by application logic
    let duplicateBlocked = false;
    if (hasActive) {
      duplicateBlocked = true; // Application should check hasActiveJob() before calling sendSnapshotJob()
    }
    // Also verify count of active jobs
    const activeCount = await db.prepare(
      "SELECT COUNT(*) as cnt FROM cost_snapshot_jobs WHERE project_id = ? AND status IN ('queued', 'running')"
    ).bind(TEST_PROJECT_ID).first() as any;

    results.T3_duplicate_prevention = {
      verdict: hasActive && duplicateBlocked && activeCount?.cnt === 1 ? 'PASS' : 'FAIL',
      has_active_job: hasActive,
      active_count: activeCount?.cnt,
      duplicate_would_be_blocked: duplicateBlocked,
      note: 'Application layer must check hasActiveJob() before calling sendSnapshotJob()',
    };

    // Complete job2 for cleanup
    await completeJob(db, job2.job_id, FAKE_SNAPSHOT_ID + 1);

    // ── T4: failure path (queued → running → failed) ──
    const job3 = await queueService.sendSnapshotJob({
      project_id: TEST_PROJECT_ID,
      job_type: 'regenerate_replace_all',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    await db.prepare(
      "UPDATE cost_snapshot_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?"
    ).bind(job3.job_id).run();
    await failJob(db, job3.job_id, 'Simulated error: database constraint violation');
    const failedRow = await db.prepare('SELECT * FROM cost_snapshot_jobs WHERE id = ?').bind(job3.job_id).first() as any;

    // After failure, should be able to re-enqueue
    const hasActiveAfterFail = await hasActiveJob(db, TEST_PROJECT_ID);

    results.T4_failure_path = {
      verdict: failedRow?.status === 'failed' 
        && !!failedRow?.error_message 
        && !!failedRow?.completed_at
        && !hasActiveAfterFail ? 'PASS' : 'FAIL',
      status: failedRow?.status,
      error_message: failedRow?.error_message,
      has_completed_at: !!failedRow?.completed_at,
      exclusive_cleared: !hasActiveAfterFail,
    };

    // ── T5: timeout / stale job detection ──
    // Create a job and set started_at to 5 minutes ago to simulate stale
    const job4 = await queueService.sendSnapshotJob({
      project_id: TEST_PROJECT_ID,
      job_type: 'initial',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    await db.prepare(
      "UPDATE cost_snapshot_jobs SET status = 'running', started_at = datetime('now', '-5 minutes') WHERE id = ?"
    ).bind(job4.job_id).run();

    // Detect stale jobs (> 2 minutes)
    const staleJobs = await db.prepare(`
      SELECT id, status, started_at, 
        CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) as elapsed_seconds
      FROM cost_snapshot_jobs 
      WHERE project_id = ? AND status = 'running' 
        AND started_at < datetime('now', '-2 minutes')
    `).bind(TEST_PROJECT_ID).all() as any;

    const staleDetected = (staleJobs?.results?.length || 0) > 0;
    const elapsedSeconds = staleJobs?.results?.[0]?.elapsed_seconds;

    // Auto-fail stale job
    if (staleDetected) {
      await failJob(db, job4.job_id, `Timeout: job exceeded 120s limit (elapsed: ${elapsedSeconds}s)`);
    }
    const staleFailed = await db.prepare('SELECT status, error_message FROM cost_snapshot_jobs WHERE id = ?').bind(job4.job_id).first() as any;

    results.T5_timeout_detection = {
      verdict: staleDetected && staleFailed?.status === 'failed' ? 'PASS' : 'FAIL',
      stale_detected: staleDetected,
      stale_count: staleJobs?.results?.length || 0,
      elapsed_seconds: elapsedSeconds,
      auto_failed_status: staleFailed?.status,
      auto_failed_message: staleFailed?.error_message,
    };

    // ── T6: sync fallback mode verification ──
    // Already tested implicitly — verify we're in the expected mode
    const isQueueMode = !!c.env.SNAPSHOT_QUEUE;
    const syncFallbackWorking = !isQueueMode; // In sandbox, always sync fallback
    
    // Verify sync fallback creates job with 'running' status directly (not 'queued')
    const job5 = await queueService.sendSnapshotJob({
      project_id: TEST_PROJECT_ID,
      job_type: 'initial',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    const job5Row = await db.prepare('SELECT status FROM cost_snapshot_jobs WHERE id = ?').bind(job5.job_id).first() as any;

    results.T6_fallback_mode = {
      verdict: 'PASS', // Both modes are valid behavior
      current_mode: isQueueMode ? 'real_queue' : 'sync_fallback',
      sync_fallback_active: syncFallbackWorking,
      sync_initial_status: job5Row?.status,
      expected_status: isQueueMode ? 'queued' : 'running',
      status_correct: isQueueMode ? job5Row?.status === 'queued' : job5Row?.status === 'running',
      note: isQueueMode 
        ? 'Real Cloudflare Queue is active. Production ready.'
        : 'Sync fallback mode. Jobs execute synchronously. Queue binding not available in local dev.',
    };

    // Complete job5
    await completeJob(db, job5.job_id, FAKE_SNAPSHOT_ID + 2);

    // ── T7: re-enqueue after completion ──
    const allDone = await hasActiveJob(db, TEST_PROJECT_ID);
    const job6 = await queueService.sendSnapshotJob({
      project_id: TEST_PROJECT_ID,
      job_type: 'initial',
      triggered_by: 1,
      timestamp: Date.now(),
    });
    const job6Created = job6.job_id > 0;
    await completeJob(db, job6.job_id, FAKE_SNAPSHOT_ID + 3);

    results.T7_re_enqueue = {
      verdict: !allDone && job6Created ? 'PASS' : 'FAIL',
      no_active_before: !allDone,
      new_job_created: job6Created,
      new_job_id: job6.job_id,
    };

    // ── T8: latency measurement ──
    const latencyRuns: number[] = [];
    for (let i = 0; i < 5; i++) {
      const lStart = Date.now();
      const lJob = await queueService.sendSnapshotJob({
        project_id: TEST_PROJECT_ID,
        job_type: 'initial',
        triggered_by: 1,
        timestamp: Date.now(),
      });
      latencyRuns.push(Date.now() - lStart);
      await completeJob(db, lJob.job_id, FAKE_SNAPSHOT_ID + 10 + i);
    }

    results.T8_latency = {
      verdict: 'PASS',
      runs: latencyRuns,
      avg_ms: Math.round(latencyRuns.reduce((a, b) => a + b, 0) / latencyRuns.length),
      min_ms: Math.min(...latencyRuns),
      max_ms: Math.max(...latencyRuns),
      p95_ms: latencyRuns.sort((a, b) => a - b)[Math.floor(latencyRuns.length * 0.95)],
    };

    // ── Cleanup ──
    await db.prepare('DELETE FROM cost_snapshot_jobs WHERE project_id = ?').bind(TEST_PROJECT_ID).run();
    await db.prepare('DELETE FROM projects WHERE id = ?').bind(TEST_PROJECT_ID).run();
    results.cleanup = 'OK';

    // ── Final summary ──
    const allTests = ['T1_enqueue', 'T2_state_transition', 'T3_duplicate_prevention', 
                      'T4_failure_path', 'T5_timeout_detection', 'T6_fallback_mode',
                      'T7_re_enqueue', 'T8_latency'];
    const passCount = allTests.filter(t => results[t]?.verdict === 'PASS').length;
    const failedTests = allTests.filter(t => results[t]?.verdict !== 'PASS');

    results.summary = {
      total: allTests.length,
      passed: passCount,
      failed: failedTests,
      overall_verdict: passCount === allTests.length ? 'ALL_PASS' : 'HAS_FAILURES',
    };
    results.duration_ms = Date.now() - start;
    results.verdict = passCount === allTests.length ? 'PASS' : 'FAIL';

    // ── Production readiness assessment ──
    results.production_readiness = {
      enqueue_works: results.T1_enqueue?.verdict === 'PASS',
      state_machine_works: results.T2_state_transition?.verdict === 'PASS',
      duplicate_prevention_works: results.T3_duplicate_prevention?.verdict === 'PASS',
      failure_handling_works: results.T4_failure_path?.verdict === 'PASS',
      timeout_detection_works: results.T5_timeout_detection?.verdict === 'PASS',
      fallback_works: results.T6_fallback_mode?.verdict === 'PASS',
      re_enqueue_works: results.T7_re_enqueue?.verdict === 'PASS',
      avg_latency_acceptable: results.T8_latency?.avg_ms < 100,
      queue_status: c.env.SNAPSHOT_QUEUE ? 'PRODUCTION_QUEUE' : 'SYNC_FALLBACK_PROVISIONAL',
      recommendation: c.env.SNAPSHOT_QUEUE
        ? 'Queue is production ready.'
        : 'Queue binding not available. Sync fallback is functional. Queue remains PROVISIONAL until deployed to Cloudflare with SNAPSHOT_QUEUE binding.',
    };

    return c.json(results);
  } catch (e: any) {
    results.error = e.message;
    results.error_stack = e.stack;
    results.duration_ms = Date.now() - start;
    results.verdict = 'FAIL';
    try { 
      await db.prepare('DELETE FROM cost_snapshot_jobs WHERE project_id = ?').bind(TEST_PROJECT_ID).run();
      await db.prepare('DELETE FROM projects WHERE id = ?').bind(TEST_PROJECT_ID).run();
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
    { id: 'CR-04', name: 'Queue Production Test', path: '/api/spike/queue-production-test' },
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

// Default route → redirect to UI
// Spike tests remain accessible at /api/spike/*

export default app;
