// ==============================================
// Snapshot API Routes
// - Enqueue (POST /api/projects/:id/snapshots/enqueue)
// - Status  (GET  /api/projects/:id/snapshots)
// - Detail  (GET  /api/projects/:id/snapshots/:snapshotId)
// Step 2.5: status遷移修正, warnings shape, error code policy
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import { createQueueService, hasActiveJob, completeJob, failJob } from '../services/queueService';
import { generateSnapshot } from '../engine/snapshotGenerator';
import { SnapshotJobType } from '../schemas/enums';
import {
  validationError, notFoundError, conflictError,
  businessRuleError, internalError,
} from '../lib/errors';

const snapshotRoutes = new Hono<AppEnv>();

snapshotRoutes.use('*', resolveUser);

// --------------------------------------------------
// POST /api/projects/:id/snapshots/enqueue
// 権限: admin, manager, estimator
// Body: { job_type: 'initial' | 'regenerate_*' }
//
// Status transition:
//   enqueue時: project.status → 'calculating'
//   sync完了時: project.status → 'in_progress' (snapshotGenerator内で設定)
//   失敗時: project.status → 元のstatusに戻す
//
// Error codes:
//   400 - invalid project ID, invalid job_type
//   404 - project not found
//   409 - duplicate active job
//   422 - initial with existing snapshot, invalid state for enqueue
// --------------------------------------------------
snapshotRoutes.post('/:id/snapshots/enqueue', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));

  if (isNaN(projectId)) {
    const err = validationError('Invalid project ID: must be a number');
    return c.json(err.body, err.status);
  }

  // Verify project exists
  const project = await db.prepare('SELECT id, status, current_snapshot_id FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) {
    const err = notFoundError('Project', projectId);
    return c.json(err.body, err.status);
  }

  // Parse request body
  const body = await c.req.json().catch(() => ({}));
  const jobType = body.job_type || 'initial';
  
  // Validate job_type (400)
  const validJobTypes = SnapshotJobType.options;
  if (!validJobTypes.includes(jobType)) {
    const err = validationError(
      `Invalid job_type: ${jobType}. Must be one of: ${validJobTypes.join(', ')}`,
      { valid_job_types: validJobTypes }
    );
    return c.json(err.body, err.status);
  }

  // Business rule: initial with existing snapshot → 422
  if (jobType === 'initial' && project.current_snapshot_id) {
    const err = businessRuleError(
      'Project already has a snapshot. Use regenerate_* job_type instead.',
      { current_snapshot_id: project.current_snapshot_id, suggestion: 'regenerate_auto_only' }
    );
    return c.json(err.body, err.status);
  }

  // Duplicate prevention: check for active jobs (409)
  const hasActive = await hasActiveJob(db, projectId);
  if (hasActive) {
    const err = conflictError(
      'Active snapshot job already exists for this project. Wait for it to complete.',
      'DUPLICATE_ENQUEUE'
    );
    return c.json(err.body, err.status);
  }

  // === 2.5-A: Set project.status → 'calculating' before enqueue ===
  const previousStatus = project.status;
  await db.prepare(
    "UPDATE projects SET status = 'calculating', updated_at = datetime('now') WHERE id = ?"
  ).bind(projectId).run();

  // Enqueue job (DB insert + queue/sync routing)
  const queueService = createQueueService(c.env);
  const job = await queueService.sendSnapshotJob({
    project_id: projectId,
    job_type: jobType,
    triggered_by: user.id,
    timestamp: Date.now(),
  });

  // === sync_fallback mode: execute immediately ===
  if (job.mode === 'sync') {
    try {
      // 2.5-E: sync path also passes through queued→running→completed
      //   queueService.sendSnapshotJob: INSERT 'queued' → UPDATE 'running'
      //   generateSnapshot: executes and sets project.status = 'in_progress'
      //   completeJob: UPDATE status = 'completed'
      const result = await generateSnapshot(db, projectId, jobType, job.job_id);
      await completeJob(db, job.job_id, result.snapshot_id);

      // Audit log
      await db.prepare(`
        INSERT INTO project_audit_logs (project_id, action, target_type, target_id, after_value, changed_by, changed_at)
        VALUES (?, 'snapshot', 'snapshot', ?, ?, ?, datetime('now'))
      `).bind(projectId, String(result.snapshot_id), JSON.stringify({
        ...result,
        status_transition: `${previousStatus} → calculating → in_progress`,
      }), user.id).run();

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
          total_amount: result.total_amount,
          duration_ms: result.duration_ms,
          status_transition: {
            before: previousStatus,
            during: 'calculating',
            after: 'in_progress',
          },
        },
      } satisfies ApiResponse, 201);
    } catch (e: any) {
      await failJob(db, job.job_id, e.message);

      // Restore project status to previous state on failure
      await db.prepare(
        "UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(previousStatus, projectId).run();

      const err = internalError(`Snapshot generation failed: ${e.message}`, {
        job_id: job.job_id,
        status_restored_to: previousStatus,
      });
      return c.json(err.body, err.status);
    }
  }

  // Queue mode: return job info (processing async)
  return c.json({
    success: true,
    data: {
      job_id: job.job_id,
      mode: 'queue',
      status: 'queued',
      status_transition: {
        before: previousStatus,
        current: 'calculating',
        next_on_complete: 'in_progress',
      },
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
    const err = validationError('Invalid project ID');
    return c.json(err.body, err.status);
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
// 2.5-C: warnings にsource, status を含む
// --------------------------------------------------
snapshotRoutes.get('/:id/snapshots/:snapshotId', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  const snapshotId = parseInt(c.req.param('snapshotId'));

  if (isNaN(projectId) || isNaN(snapshotId)) {
    const err = validationError('Invalid ID: project_id and snapshot_id must be numbers');
    return c.json(err.body, err.status);
  }

  // Fetch snapshot
  const snapshot = await db.prepare(
    'SELECT * FROM project_cost_snapshots WHERE id = ? AND project_id = ?'
  ).bind(snapshotId, projectId).first();

  if (!snapshot) {
    const err = notFoundError('Snapshot', snapshotId);
    return c.json(err.body, err.status);
  }

  // Fetch items
  const items = await db.prepare(`
    SELECT id, category_code, master_item_id, item_name, unit,
           calculation_type, is_selected, selection_reason,
           auto_quantity, auto_unit_price, auto_fixed_amount, auto_amount,
           manual_quantity, manual_unit_price, manual_amount,
           final_quantity, final_unit_price, final_amount,
           review_status, override_reason, override_reason_category,
           vendor_name, calculation_basis_note, warning_text,
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

  // Fetch warnings — 2.5-C: include source and status fields
  const warnings = await db.prepare(`
    SELECT id, warning_type, severity, category_code, master_item_id,
           message, recommendation, detail_json,
           source, status, is_resolved,
           resolved_by, resolved_at, resolved_note
    FROM project_warnings
    WHERE project_id = ? AND snapshot_id = ?
    ORDER BY 
      CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
      warning_type
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

  if (isNaN(projectId) || isNaN(jobId)) {
    const err = validationError('Invalid ID: project_id and job_id must be numbers');
    return c.json(err.body, err.status);
  }

  const job = await db.prepare(
    'SELECT * FROM cost_snapshot_jobs WHERE id = ? AND project_id = ?'
  ).bind(jobId, projectId).first();

  if (!job) {
    const err = notFoundError('Job', jobId);
    return c.json(err.body, err.status);
  }

  return c.json({
    success: true,
    data: job,
  } satisfies ApiResponse);
});

export default snapshotRoutes;
