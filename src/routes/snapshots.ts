// ==============================================
// Snapshot API Routes (Step 3)
// - Enqueue (POST) — initial / regenerate_*
// - List / Detail / Job status (GET)
// - Diffs (GET / POST resolution)
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import { createQueueService, hasActiveJob, completeJob, failJob } from '../services/queueService';
import { generateSnapshot } from '../engine/snapshotGenerator';
import { regenerateSnapshot, type RegenerateMode } from '../engine/regenerateEngine';
import { SnapshotJobType } from '../schemas/enums';
import {
  validationError, notFoundError, conflictError,
  businessRuleError, internalError, forbiddenError,
} from '../lib/errors';

const snapshotRoutes = new Hono<AppEnv>();

snapshotRoutes.use('*', resolveUser);

// ==========================================================
// POST /api/projects/:id/snapshots/enqueue
// 権限: admin, manager, estimator
//   ※ replace_all は manager以上のみ
// Body: { job_type: 'initial' | 'regenerate_preserve_reviewed' | 'regenerate_auto_only' | 'regenerate_replace_all' }
// ==========================================================
snapshotRoutes.post('/:id/snapshots/enqueue', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));

  if (isNaN(projectId)) {
    const err = validationError('Invalid project ID: must be a number');
    return c.json(err.body, err.status);
  }

  const project = await db.prepare('SELECT id, status, current_snapshot_id FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) {
    const err = notFoundError('Project', projectId);
    return c.json(err.body, err.status);
  }

  const body = await c.req.json().catch(() => ({}));
  const jobType = body.job_type || 'initial';

  const validJobTypes = SnapshotJobType.options;
  if (!validJobTypes.includes(jobType)) {
    const err = validationError(
      `Invalid job_type: ${jobType}. Must be one of: ${validJobTypes.join(', ')}`,
      { valid_job_types: validJobTypes }
    );
    return c.json(err.body, err.status);
  }

  // === Business rules ===
  // initial + existing snapshot → 422
  if (jobType === 'initial' && project.current_snapshot_id) {
    const err = businessRuleError(
      'Project already has a snapshot. Use regenerate_* job_type instead.',
      { current_snapshot_id: project.current_snapshot_id, suggestion: 'regenerate_preserve_reviewed' }
    );
    return c.json(err.body, err.status);
  }
  // regenerate_* without snapshot → 422
  if (jobType !== 'initial' && !project.current_snapshot_id) {
    const err = businessRuleError(
      'Project has no snapshot to regenerate. Use initial job_type first.',
    );
    return c.json(err.body, err.status);
  }
  // replace_all requires manager or admin → 403
  if (jobType === 'regenerate_replace_all' && !['admin', 'manager'].includes(user.role)) {
    const err = forbiddenError('regenerate_replace_all requires manager or admin role');
    return c.json(err.body, err.status);
  }

  // Check for unresolved diffs from previous regeneration (409 for preserve_reviewed/auto_only)
  if (jobType.startsWith('regenerate_') && jobType !== 'regenerate_replace_all') {
    const unresolvedDiffs = await db.prepare(
      "SELECT COUNT(*) as cnt FROM project_cost_regeneration_diffs WHERE project_id = ? AND resolution_status = 'pending'"
    ).bind(projectId).first() as any;
    if (unresolvedDiffs?.cnt > 0) {
      const err = conflictError(
        `${unresolvedDiffs.cnt} unresolved diffs exist. Resolve or dismiss all diffs before regenerating.`,
        'STATE_MISMATCH',
        { unresolved_count: unresolvedDiffs.cnt, suggestion: 'resolve_diffs_first_or_use_replace_all' }
      );
      return c.json(err.body, err.status);
    }
  }

  // Duplicate prevention (409)
  const hasActive = await hasActiveJob(db, projectId);
  if (hasActive) {
    const err = conflictError(
      'Active snapshot job already exists for this project.',
      'DUPLICATE_ENQUEUE'
    );
    return c.json(err.body, err.status);
  }

  // Set project.status → 'calculating'
  const previousStatus = project.status;
  await db.prepare(
    "UPDATE projects SET status = 'calculating', updated_at = datetime('now') WHERE id = ?"
  ).bind(projectId).run();

  // Enqueue job
  const queueService = createQueueService(c.env);
  const job = await queueService.sendSnapshotJob({
    project_id: projectId,
    job_type: jobType,
    triggered_by: user.id,
    timestamp: Date.now(),
  });

  // === Sync fallback: execute immediately ===
  if (job.mode === 'sync') {
    try {
      let result: any;

      if (jobType === 'initial') {
        result = await generateSnapshot(db, projectId, jobType, job.job_id);
      } else {
        // Map job_type to regenerate mode
        const modeMap: Record<string, RegenerateMode> = {
          'regenerate_preserve_reviewed': 'preserve_reviewed',
          'regenerate_auto_only': 'auto_only',
          'regenerate_replace_all': 'replace_all',
        };
        const mode = modeMap[jobType] || 'preserve_reviewed';
        result = await regenerateSnapshot(db, projectId, mode, job.job_id);
      }

      await completeJob(db, job.job_id, result.snapshot_id);

      // Audit log
      await db.prepare(`
        INSERT INTO project_audit_logs (project_id, action, target_type, target_id, after_value, changed_by, changed_at)
        VALUES (?, ?, 'snapshot', ?, ?, ?, datetime('now'))
      `).bind(
        projectId,
        jobType === 'initial' ? 'snapshot' : 'regenerate',
        String(result.snapshot_id),
        JSON.stringify({
          ...result,
          status_transition: `${previousStatus} → calculating → in_progress`,
        }),
        user.id
      ).run();

      return c.json({
        success: true,
        data: {
          job_id: job.job_id,
          job_type: jobType,
          mode: 'sync',
          status: 'completed',
          snapshot_id: result.snapshot_id,
          items_created: result.items_created,
          summaries_created: result.summaries_created,
          warnings_created: result.warnings_created,
          total_amount: result.total_amount,
          duration_ms: result.duration_ms,
          // Regenerate-specific fields
          ...(result.old_snapshot_id !== undefined && {
            old_snapshot_id: result.old_snapshot_id,
            regenerate_mode: result.mode,
            diffs_created: result.diffs_created,
            preserved_count: result.preserved_count,
            recalculated_count: result.recalculated_count,
            significant_diffs: result.significant_diffs,
          }),
          status_transition: {
            before: previousStatus,
            during: 'calculating',
            after: 'in_progress',
          },
        },
      } satisfies ApiResponse, 201);
    } catch (e: any) {
      await failJob(db, job.job_id, e.message);
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

  // Queue mode
  return c.json({
    success: true,
    data: {
      job_id: job.job_id,
      job_type: jobType,
      mode: 'queue',
      status: 'queued',
      status_transition: { before: previousStatus, current: 'calculating', next_on_complete: 'in_progress' },
      message: 'Snapshot job enqueued.',
    },
  } satisfies ApiResponse, 202);
});

// ==========================================================
// GET /api/projects/:id/snapshots
// ==========================================================
snapshotRoutes.get('/:id/snapshots', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const result = await db.prepare(`
    SELECT id, project_id, snapshot_no, status, 
           total_cost, total_standard_cost, total_solar_cost, total_option_cost,
           items_count, categories_count, confirmed_count, warning_count,
           created_at
    FROM project_cost_snapshots
    WHERE project_id = ?
    ORDER BY snapshot_no DESC
  `).bind(projectId).all();

  return c.json({ success: true, data: result.results, meta: { total: result.results?.length || 0 } } satisfies ApiResponse);
});

// ==========================================================
// GET /api/projects/:id/snapshots/:snapshotId
// ==========================================================
snapshotRoutes.get('/:id/snapshots/:snapshotId', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  const snapshotId = parseInt(c.req.param('snapshotId'));
  if (isNaN(projectId) || isNaN(snapshotId)) { const err = validationError('Invalid IDs'); return c.json(err.body, err.status); }

  const snapshot = await db.prepare(
    'SELECT * FROM project_cost_snapshots WHERE id = ? AND project_id = ?'
  ).bind(snapshotId, projectId).first();
  if (!snapshot) { const err = notFoundError('Snapshot', snapshotId); return c.json(err.body, err.status); }

  const items = await db.prepare(`
    SELECT id, category_code, master_item_id, item_name, unit,
           calculation_type, is_selected, selection_reason,
           auto_quantity, auto_unit_price, auto_fixed_amount, auto_amount,
           manual_quantity, manual_unit_price, manual_amount,
           final_quantity, final_unit_price, final_amount,
           review_status, override_reason, override_reason_category,
           vendor_name, calculation_basis_note, warning_text,
           sort_order
    FROM project_cost_items WHERE snapshot_id = ? AND project_id = ?
    ORDER BY category_code, sort_order
  `).bind(snapshotId, projectId).all();

  const summaries = await db.prepare(`
    SELECT id, category_code, auto_total_amount, manual_adjustment_amount, final_total_amount, review_status
    FROM project_cost_summaries WHERE project_id = ? ORDER BY category_code
  `).bind(projectId).all();

  const warnings = await db.prepare(`
    SELECT id, warning_type, severity, category_code, master_item_id,
           message, recommendation, detail_json, source, status, is_resolved,
           resolved_by, resolved_at, resolved_note
    FROM project_warnings WHERE project_id = ? AND snapshot_id = ?
    ORDER BY CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END, warning_type
  `).bind(projectId, snapshotId).all();

  return c.json({
    success: true,
    data: { snapshot, items: items.results, summaries: summaries.results, warnings: warnings.results },
    meta: { items_count: items.results?.length || 0, summaries_count: summaries.results?.length || 0, warnings_count: warnings.results?.length || 0 },
  });
});

// ==========================================================
// GET /api/projects/:id/snapshots/jobs/:jobId
// ==========================================================
snapshotRoutes.get('/:id/snapshots/jobs/:jobId', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  const jobId = parseInt(c.req.param('jobId'));
  if (isNaN(projectId) || isNaN(jobId)) { const err = validationError('Invalid IDs'); return c.json(err.body, err.status); }

  const job = await db.prepare('SELECT * FROM cost_snapshot_jobs WHERE id = ? AND project_id = ?').bind(jobId, projectId).first();
  if (!job) { const err = notFoundError('Job', jobId); return c.json(err.body, err.status); }

  return c.json({ success: true, data: job } satisfies ApiResponse);
});

// ==========================================================
// GET /api/projects/:id/diffs
// Query: ?snapshot_id=N  &significant_only=true  &category=xxx  &status=pending
// ==========================================================
snapshotRoutes.get('/:id/diffs', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const snapshotId = c.req.query('snapshot_id');
  const significantOnly = c.req.query('significant_only') === 'true';
  const category = c.req.query('category');
  const status = c.req.query('status');

  let sql = `
    SELECT d.*, j.job_type
    FROM project_cost_regeneration_diffs d
    LEFT JOIN cost_snapshot_jobs j ON j.id = d.job_id
    WHERE d.project_id = ?
  `;
  const binds: any[] = [projectId];

  if (snapshotId) { sql += ' AND d.new_snapshot_id = ?'; binds.push(parseInt(snapshotId)); }
  if (significantOnly) { sql += ' AND d.is_significant = 1'; }
  if (category) { sql += ' AND d.category_code = ?'; binds.push(category); }
  if (status) { sql += ' AND d.resolution_status = ?'; binds.push(status); }

  sql += ' ORDER BY d.resolution_status = \'pending\' DESC, d.is_significant DESC, ABS(d.change_amount) DESC';

  const result = await db.prepare(sql).bind(...binds).all();

  // Summary stats
  const allDiffs = (result.results || []) as any[];
  const significantCount = allDiffs.filter(d => d.is_significant).length;
  const totalChangeAmount = allDiffs.reduce((sum, d) => sum + (d.change_amount || 0), 0);
  const pendingCount = allDiffs.filter(d => d.resolution_status === 'pending').length;
  const adoptedCount = allDiffs.filter(d => d.resolution_status === 'adopted').length;
  const keptCount = allDiffs.filter(d => d.resolution_status === 'kept').length;
  const dismissedCount = allDiffs.filter(d => d.resolution_status === 'dismissed').length;
  const manualCount = allDiffs.filter(d => d.resolution_status === 'manual_adjusted').length;

  return c.json({
    success: true,
    data: result.results,
    meta: {
      total: allDiffs.length,
      significant: significantCount,
      total_change_amount: Math.round(totalChangeAmount),
      resolution_summary: {
        pending: pendingCount,
        adopted: adoptedCount,
        kept: keptCount,
        dismissed: dismissedCount,
        manual_adjusted: manualCount,
      },
    },
  });
});

// ==========================================================
// POST /api/projects/:id/diffs/:diffId/resolve
// 権限: admin, manager, estimator
// Body: { 
//   action: 'adopt_candidate' | 'keep_current' | 'dismiss' | 'manual_adjust',
//   manual_amount?: number,   (required for manual_adjust)
//   note?: string,
//   reason_category?: string
// }
//
// State rules:
//   adopt_candidate → review_status='needs_review', resolution_status='adopted'
//   manual_adjust   → review_status='needs_review', resolution_status='manual_adjusted'
//   keep_current    → review_status unchanged, resolution_status='kept'
//   dismiss         → review_status unchanged, resolution_status='dismissed'
// ==========================================================
snapshotRoutes.post('/:id/diffs/:diffId/resolve', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));
  const diffId = parseInt(c.req.param('diffId'));

  if (isNaN(projectId) || isNaN(diffId)) {
    const err = validationError('Invalid IDs');
    return c.json(err.body, err.status);
  }

  const body = await c.req.json().catch(() => ({}));
  const action = body.action;
  const validActions = ['adopt_candidate', 'keep_current', 'dismiss', 'manual_adjust'];
  if (!validActions.includes(action)) {
    const err = validationError(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
    return c.json(err.body, err.status);
  }

  // Fetch diff
  const diff = await db.prepare(
    'SELECT * FROM project_cost_regeneration_diffs WHERE id = ? AND project_id = ?'
  ).bind(diffId, projectId).first() as any;
  if (!diff) { const err = notFoundError('Diff', diffId); return c.json(err.body, err.status); }

  // Already resolved? → 409
  if (diff.resolution_status !== 'pending') {
    const err = conflictError(
      `Diff already resolved with status: ${diff.resolution_status}`,
      'STATE_MISMATCH',
      { current_status: diff.resolution_status }
    );
    return c.json(err.body, err.status);
  }

  // Fetch the project's current snapshot
  const project = await db.prepare('SELECT current_snapshot_id, revision_no FROM projects WHERE id = ?').bind(projectId).first() as any;
  if (!project?.current_snapshot_id) {
    const err = businessRuleError('Project has no active snapshot');
    return c.json(err.body, err.status);
  }

  // Diff must be for current snapshot
  if (diff.new_snapshot_id !== project.current_snapshot_id) {
    const err = businessRuleError(
      'Diff belongs to a superseded snapshot. Only diffs for the current snapshot can be resolved.',
      { diff_snapshot: diff.new_snapshot_id, current_snapshot: project.current_snapshot_id }
    );
    return c.json(err.body, err.status);
  }

  // Fetch the affected cost item in the new snapshot
  const costItem = await db.prepare(
    'SELECT * FROM project_cost_items WHERE project_id = ? AND snapshot_id = ? AND master_item_id = ?'
  ).bind(projectId, diff.new_snapshot_id, diff.master_item_id).first() as any;

  if (!costItem) {
    const err = notFoundError('Cost item for this diff', diff.master_item_id);
    return c.json(err.body, err.status);
  }

  const stmts: D1PreparedStatement[] = [];
  let newReviewStatus = costItem.review_status;
  let updatedItemFields: Record<string, any> = {};
  let resolutionStatus: string;
  let manualAdjustedAmount: number | null = null;

  switch (action) {
    case 'adopt_candidate': {
      // Accept the new auto-calculated value → review_status = 'needs_review'
      newReviewStatus = 'needs_review';
      resolutionStatus = 'adopted';
      updatedItemFields = {
        final_quantity: costItem.auto_quantity,
        final_unit_price: costItem.auto_unit_price,
        final_amount: costItem.auto_amount,
        manual_quantity: null,
        manual_unit_price: null,
        manual_amount: null,
        override_reason: null,
        override_reason_category: null,
        review_status: newReviewStatus,
      };
      stmts.push(db.prepare(`
        UPDATE project_cost_items SET
          final_quantity = auto_quantity, final_unit_price = auto_unit_price, final_amount = auto_amount,
          manual_quantity = NULL, manual_unit_price = NULL, manual_amount = NULL,
          override_reason = NULL, override_reason_category = NULL,
          review_status = 'needs_review', version = version + 1, updated_at = datetime('now')
        WHERE id = ?
      `).bind(costItem.id));
      break;
    }
    case 'keep_current': {
      // Keep the current (possibly preserved) value — no change to item, just mark diff
      newReviewStatus = costItem.review_status; // unchanged
      resolutionStatus = 'kept';
      break;
    }
    case 'dismiss': {
      // Explicitly dismiss the diff — no item change
      newReviewStatus = costItem.review_status;
      resolutionStatus = 'dismissed';
      break;
    }
    case 'manual_adjust': {
      // Apply user-provided amount → review_status = 'needs_review'
      const amt = body.manual_amount;
      if (amt === undefined || typeof amt !== 'number') {
        const err = validationError('manual_adjust requires manual_amount (number)');
        return c.json(err.body, err.status);
      }
      newReviewStatus = 'needs_review';
      resolutionStatus = 'manual_adjusted';
      manualAdjustedAmount = amt;
      updatedItemFields = {
        manual_amount: amt,
        final_amount: amt,
        override_reason: body.note || 'diff_manual_adjust',
        override_reason_category: body.reason_category || 'correction',
        review_status: newReviewStatus,
      };
      stmts.push(db.prepare(`
        UPDATE project_cost_items SET
          manual_amount = ?, final_amount = ?,
          override_reason = ?, override_reason_category = ?,
          review_status = 'needs_review', version = version + 1, updated_at = datetime('now')
        WHERE id = ?
      `).bind(amt, amt, body.note || 'diff_manual_adjust', body.reason_category || 'correction', costItem.id));
      break;
    }
    default:
      resolutionStatus = 'pending';
  }

  // === Update diff resolution_status ===
  stmts.push(db.prepare(`
    UPDATE project_cost_regeneration_diffs SET
      resolution_status = ?, resolution_note = ?, resolved_by = ?,
      resolved_at = datetime('now'), manual_adjusted_amount = ?
    WHERE id = ?
  `).bind(resolutionStatus!, body.note || null, user.id, manualAdjustedAmount, diffId));

  // Recalculate category summary if item was changed
  if (updatedItemFields.final_amount !== undefined) {
    // Update summary for this category
    stmts.push(db.prepare(`
      UPDATE project_cost_summaries SET
        final_total_amount = (
          SELECT COALESCE(SUM(final_amount), 0) 
          FROM project_cost_items 
          WHERE project_id = ? AND snapshot_id = ? AND category_code = ? AND is_selected = 1
        ),
        auto_total_amount = (
          SELECT COALESCE(SUM(auto_amount), 0) 
          FROM project_cost_items 
          WHERE project_id = ? AND snapshot_id = ? AND category_code = ? AND is_selected = 1
        ),
        manual_adjustment_amount = (
          SELECT COALESCE(SUM(final_amount), 0) - COALESCE(SUM(auto_amount), 0)
          FROM project_cost_items 
          WHERE project_id = ? AND snapshot_id = ? AND category_code = ? AND is_selected = 1
        ),
        updated_at = datetime('now')
      WHERE project_id = ? AND category_code = ?
    `).bind(
      projectId, diff.new_snapshot_id, costItem.category_code,
      projectId, diff.new_snapshot_id, costItem.category_code,
      projectId, diff.new_snapshot_id, costItem.category_code,
      projectId, costItem.category_code
    ));

    // Update snapshot total_cost
    stmts.push(db.prepare(`
      UPDATE project_cost_snapshots SET
        total_cost = (SELECT COALESCE(SUM(final_total_amount), 0) FROM project_cost_summaries WHERE project_id = ?),
        total_standard_cost = (
          SELECT COALESCE(SUM(s.final_total_amount), 0)
          FROM project_cost_summaries s
          JOIN cost_categories c ON c.category_code = s.category_code
          WHERE s.project_id = ? AND c.gross_margin_group = 'standard'
        ),
        total_solar_cost = (
          SELECT COALESCE(SUM(s.final_total_amount), 0)
          FROM project_cost_summaries s
          JOIN cost_categories c ON c.category_code = s.category_code
          WHERE s.project_id = ? AND c.gross_margin_group = 'solar'
        ),
        total_option_cost = (
          SELECT COALESCE(SUM(s.final_total_amount), 0)
          FROM project_cost_summaries s
          JOIN cost_categories c ON c.category_code = s.category_code
          WHERE s.project_id = ? AND c.gross_margin_group = 'option'
        )
      WHERE id = ?
    `).bind(projectId, projectId, projectId, projectId, diff.new_snapshot_id));
  }

  // Audit log
  stmts.push(db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, before_value, after_value, field_name, changed_by, changed_at)
    VALUES (?, 'update', 'cost_item', ?, ?, ?, 'diff_resolve', ?, datetime('now'))
  `).bind(
    projectId,
    String(costItem.id),
    JSON.stringify({ diff_id: diffId, action, old_amount: costItem.final_amount, old_review_status: costItem.review_status }),
    JSON.stringify({ action, resolution_status: resolutionStatus!, new_review_status: newReviewStatus, ...updatedItemFields }),
    user.id
  ));

  // Execute batch
  await db.batch(stmts);

  // Fetch updated state
  const updatedDiff = await db.prepare('SELECT * FROM project_cost_regeneration_diffs WHERE id = ?').bind(diffId).first();
  const updatedItem = await db.prepare('SELECT id, final_amount, review_status, version FROM project_cost_items WHERE id = ?').bind(costItem.id).first();

  // Count remaining pending diffs
  const pendingDiffs = await db.prepare(
    "SELECT COUNT(*) as cnt FROM project_cost_regeneration_diffs WHERE project_id = ? AND new_snapshot_id = ? AND resolution_status = 'pending'"
  ).bind(projectId, diff.new_snapshot_id).first() as any;

  return c.json({
    success: true,
    data: {
      diff_id: diffId,
      action,
      resolution_status: resolutionStatus!,
      cost_item_id: costItem.id,
      previous_review_status: costItem.review_status,
      new_review_status: newReviewStatus,
      updated_item: updatedItem,
      updated_diff: updatedDiff,
    },
    meta: {
      remaining_pending_diffs: pendingDiffs?.cnt || 0,
    },
  });
});

// ==========================================================
// POST /api/projects/:id/diffs/resolve-all
// 権限: admin, manager
// Body: { action: 'keep_current' | 'dismiss', note?: string }
// Bulk resolve all pending diffs
// ==========================================================
snapshotRoutes.post('/:id/diffs/resolve-all', requireRole('admin', 'manager'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const body = await c.req.json().catch(() => ({}));
  const action = body.action;
  if (!['keep_current', 'dismiss'].includes(action)) {
    const err = validationError('Bulk resolve only supports keep_current or dismiss');
    return c.json(err.body, err.status);
  }

  const project = await db.prepare('SELECT current_snapshot_id FROM projects WHERE id = ?').bind(projectId).first() as any;
  if (!project?.current_snapshot_id) {
    const err = businessRuleError('No active snapshot');
    return c.json(err.body, err.status);
  }

  const resolutionStatus = action === 'keep_current' ? 'kept' : 'dismissed';

  // Count before
  const beforeCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM project_cost_regeneration_diffs WHERE project_id = ? AND new_snapshot_id = ? AND resolution_status = 'pending'"
  ).bind(projectId, project.current_snapshot_id).first() as any;

  // Bulk update
  await db.prepare(`
    UPDATE project_cost_regeneration_diffs SET
      resolution_status = ?, resolution_note = ?, resolved_by = ?,
      resolved_at = datetime('now')
    WHERE project_id = ? AND new_snapshot_id = ? AND resolution_status = 'pending'
  `).bind(resolutionStatus, body.note || `bulk_${action}`, user.id, projectId, project.current_snapshot_id).run();

  // Audit
  await db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, after_value, changed_by, changed_at)
    VALUES (?, 'update', 'snapshot', ?, ?, ?, datetime('now'))
  `).bind(
    projectId, String(project.current_snapshot_id),
    JSON.stringify({ action: `bulk_${action}`, count: beforeCount?.cnt || 0, resolution_status: resolutionStatus }),
    user.id
  ).run();

  return c.json({
    success: true,
    data: {
      action,
      resolution_status: resolutionStatus,
      resolved_count: beforeCount?.cnt || 0,
    },
  });
});

export default snapshotRoutes;
