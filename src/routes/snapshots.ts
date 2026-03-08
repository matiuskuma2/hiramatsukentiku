// ==============================================
// Snapshot API Routes
// - Enqueue (POST /api/projects/:id/snapshots/enqueue)
// - Status  (GET  /api/projects/:id/snapshots)
// - Detail  (GET  /api/projects/:id/snapshots/:snapshotId)
// 条件: project 作成と snapshot enqueue は分離実装
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import { createQueueService, hasActiveJob, completeJob, failJob } from '../services/queueService';
import { generateSnapshot } from '../engine/snapshotGenerator';
import { SnapshotJobType } from '../schemas/enums';

const snapshotRoutes = new Hono<AppEnv>();

snapshotRoutes.use('*', resolveUser);

// --------------------------------------------------
// POST /api/projects/:id/snapshots/enqueue
// 権限: admin, manager, estimator
// Body: { job_type: 'initial' | 'regenerate_*' }
// --------------------------------------------------
snapshotRoutes.post('/:id/snapshots/enqueue', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));

  if (isNaN(projectId)) {
    return c.json({ success: false, error: 'Invalid project ID' }, 400);
  }

  // Verify project exists
  const project = await db.prepare('SELECT id, status, current_snapshot_id FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) {
    return c.json({ success: false, error: `Project not found: ${projectId}` }, 404);
  }

  // Parse request body
  const body = await c.req.json().catch(() => ({}));
  const jobType = body.job_type || 'initial';
  
  // Validate job_type
  const validJobTypes = SnapshotJobType.options;
  if (!validJobTypes.includes(jobType)) {
    return c.json({ 
      success: false, 
      error: `Invalid job_type: ${jobType}. Must be one of: ${validJobTypes.join(', ')}` 
    }, 400);
  }

  // If initial and project already has snapshot, suggest regenerate
  if (jobType === 'initial' && project.current_snapshot_id) {
    return c.json({
      success: false,
      error: 'Project already has a snapshot. Use regenerate_* job_type instead.',
      data: { current_snapshot_id: project.current_snapshot_id },
    }, 409);
  }

  // Duplicate prevention: check for active jobs
  const hasActive = await hasActiveJob(db, projectId);
  if (hasActive) {
    return c.json({
      success: false,
      error: 'Active snapshot job already exists for this project. Wait for it to complete.',
    }, 409);
  }

  // Enqueue job
  const queueService = createQueueService(c.env);
  const job = await queueService.sendSnapshotJob({
    project_id: projectId,
    job_type: jobType,
    triggered_by: user.id,
    timestamp: Date.now(),
  });

  // In sync_fallback mode, execute immediately
  if (job.mode === 'sync') {
    try {
      const result = await generateSnapshot(db, projectId, jobType, job.job_id);
      await completeJob(db, job.job_id, result.snapshot_id);

      // Audit log
      await db.prepare(`
        INSERT INTO project_audit_logs (project_id, action, target_type, target_id, after_value, changed_by, changed_at)
        VALUES (?, 'snapshot', 'snapshot', ?, ?, ?, datetime('now'))
      `).bind(projectId, String(result.snapshot_id), JSON.stringify(result), user.id).run();

      return c.json({
        success: true,
        data: {
          job_id: job.job_id,
          mode: 'sync',
          status: 'completed',
          snapshot_id: result.snapshot_id,
          items_created: result.items_created,
          summaries_created: result.summaries_created,
          warnings_created: result.warnings_created,
        },
      } satisfies ApiResponse, 201);
    } catch (e: any) {
      await failJob(db, job.job_id, e.message);
      return c.json({
        success: false,
        error: `Snapshot generation failed: ${e.message}`,
        data: { job_id: job.job_id },
      }, 500);
    }
  }

  // Queue mode: return job info (processing async)
  return c.json({
    success: true,
    data: {
      job_id: job.job_id,
      mode: 'queue',
      status: 'queued',
      message: 'Snapshot job enqueued. Poll GET /api/projects/:id/snapshots/jobs/:jobId for status.',
    },
  } satisfies ApiResponse, 202);
});

// --------------------------------------------------
// GET /api/projects/:id/snapshots
// 権限: all (viewer以上)
// --------------------------------------------------
snapshotRoutes.get('/:id/snapshots', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));

  if (isNaN(projectId)) {
    return c.json({ success: false, error: 'Invalid project ID' }, 400);
  }

  const result = await db.prepare(`
    SELECT id, project_id, snapshot_no, status, 
           total_cost, total_standard_cost, total_solar_cost, total_option_cost,
           items_count, categories_count, warning_count,
           created_at
    FROM project_cost_snapshots
    WHERE project_id = ?
    ORDER BY snapshot_no DESC
  `).bind(projectId).all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/projects/:id/snapshots/:snapshotId
// 権限: all (viewer以上)
// Detail: snapshot + items + summaries + warnings
// --------------------------------------------------
snapshotRoutes.get('/:id/snapshots/:snapshotId', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  const snapshotId = parseInt(c.req.param('snapshotId'));

  if (isNaN(projectId) || isNaN(snapshotId)) {
    return c.json({ success: false, error: 'Invalid ID' }, 400);
  }

  // Fetch snapshot
  const snapshot = await db.prepare(
    'SELECT * FROM project_cost_snapshots WHERE id = ? AND project_id = ?'
  ).bind(snapshotId, projectId).first();

  if (!snapshot) {
    return c.json({ success: false, error: 'Snapshot not found' }, 404);
  }

  // Fetch items
  const items = await db.prepare(`
    SELECT id, category_code, master_item_id, item_name, unit,
           calculation_type, is_selected, selection_reason,
           auto_quantity, auto_unit_price, auto_fixed_amount, auto_amount,
           manual_quantity, manual_unit_price, manual_amount,
           final_quantity, final_unit_price, final_amount,
           review_status, override_reason, override_reason_category,
           sort_order
    FROM project_cost_items
    WHERE snapshot_id = ? AND project_id = ?
    ORDER BY category_code, sort_order
  `).bind(snapshotId, projectId).all();

  // Fetch summaries (no snapshot_id in this table)
  const summaries = await db.prepare(`
    SELECT id, category_code, auto_total_amount,
           manual_adjustment_amount, final_total_amount,
           review_status
    FROM project_cost_summaries
    WHERE project_id = ?
    ORDER BY category_code
  `).bind(projectId).all();

  // Fetch warnings
  const warnings = await db.prepare(`
    SELECT id, warning_type, severity, category_code, master_item_id,
           message, recommendation, detail_json, is_resolved
    FROM project_warnings
    WHERE project_id = ? AND snapshot_id = ?
    ORDER BY severity DESC, warning_type
  `).bind(projectId, snapshotId).all();

  return c.json({
    success: true,
    data: {
      snapshot,
      items: items.results,
      summaries: summaries.results,
      warnings: warnings.results,
    },
    meta: {
      items_count: items.results?.length || 0,
      summaries_count: summaries.results?.length || 0,
      warnings_count: warnings.results?.length || 0,
    },
  });
});

// --------------------------------------------------
// GET /api/projects/:id/snapshots/jobs/:jobId
// 権限: all (viewer以上)
// Poll endpoint for job status
// --------------------------------------------------
snapshotRoutes.get('/:id/snapshots/jobs/:jobId', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  const jobId = parseInt(c.req.param('jobId'));

  const job = await db.prepare(
    'SELECT * FROM cost_snapshot_jobs WHERE id = ? AND project_id = ?'
  ).bind(jobId, projectId).first();

  if (!job) {
    return c.json({ success: false, error: 'Job not found' }, 404);
  }

  return c.json({
    success: true,
    data: job,
  } satisfies ApiResponse);
});

export default snapshotRoutes;
