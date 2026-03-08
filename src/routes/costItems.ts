// ==============================================
// Cost Item Update API (Step 3: 工種詳細 update)
// 
// 対象:
//   - 手修正数量 / 単価 / 金額
//   - 理由コード + コメント
//   - review_status
//   - lock / unlock
//
// 鉄則: 明細更新と工種合計更新を同一TX
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import {
  validationError, notFoundError, conflictError,
  businessRuleError,
} from '../lib/errors';
import { ReviewStatus, OverrideReasonCategory } from '../schemas/enums';
import { z } from 'zod';

const costItemRoutes = new Hono<AppEnv>();
costItemRoutes.use('*', resolveUser);

// === Zod schema for item update ===
const UpdateCostItemSchema = z.object({
  manual_quantity: z.number().nullable().optional(),
  manual_unit_price: z.number().nullable().optional(),
  manual_amount: z.number().nullable().optional(),
  override_reason: z.string().max(500).nullable().optional(),
  override_reason_category: OverrideReasonCategory.nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  review_status: ReviewStatus.optional(),
  vendor_name: z.string().max(200).nullable().optional(),
  evidence_file_key: z.string().max(500).nullable().optional(),
}).refine(data => {
  // At least one field must be provided
  return Object.values(data).some(v => v !== undefined);
}, { message: 'At least one field must be provided for update' });

// === Review status transition schema ===
const ReviewTransitionSchema = z.object({
  review_status: ReviewStatus,
  comment: z.string().max(500).optional(),
});

// ==========================================================
// PATCH /api/projects/:id/cost-items/:itemId
// 権限: admin, manager, estimator
// Body: { manual_quantity?, manual_unit_price?, manual_amount?, override_reason?, override_reason_category?, note?, review_status? }
//
// 鉄則: 明細更新 + 工種合計 recalc を同一TX
// ==========================================================
costItemRoutes.patch('/:id/cost-items/:itemId', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));
  const itemId = parseInt(c.req.param('itemId'));

  if (isNaN(projectId) || isNaN(itemId)) {
    const err = validationError('Invalid IDs');
    return c.json(err.body, err.status);
  }

  const body = await c.req.json();
  const parsed = UpdateCostItemSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  // Fetch project
  const project = await db.prepare('SELECT id, current_snapshot_id, revision_no, status FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) { const err = notFoundError('Project', projectId); return c.json(err.body, err.status); }
  if (!project.current_snapshot_id) {
    const err = businessRuleError('Project has no active snapshot');
    return c.json(err.body, err.status);
  }

  // Fetch cost item
  const item = await db.prepare(
    'SELECT * FROM project_cost_items WHERE id = ? AND project_id = ? AND snapshot_id = ?'
  ).bind(itemId, projectId, project.current_snapshot_id).first() as any;
  if (!item) { const err = notFoundError('Cost item', itemId); return c.json(err.body, err.status); }

  // Optimistic lock check
  if (body.version !== undefined && body.version !== item.version) {
    const err = conflictError(
      `Optimistic lock conflict: expected version ${body.version}, current is ${item.version}`,
      'OPTIMISTIC_LOCK_CONFLICT',
      { current_version: item.version }
    );
    return c.json(err.body, err.status);
  }

  const d = parsed.data;
  const stmts: D1PreparedStatement[] = [];
  const changes: Record<string, { old: any; new: any }> = {};

  // --- Build SET clause dynamically ---
  const setClauses: string[] = [];
  const setBinds: any[] = [];

  // Manual quantity
  if (d.manual_quantity !== undefined) {
    setClauses.push('manual_quantity = ?');
    setBinds.push(d.manual_quantity);
    changes.manual_quantity = { old: item.manual_quantity, new: d.manual_quantity };
  }

  // Manual unit price
  if (d.manual_unit_price !== undefined) {
    setClauses.push('manual_unit_price = ?');
    setBinds.push(d.manual_unit_price);
    changes.manual_unit_price = { old: item.manual_unit_price, new: d.manual_unit_price };
  }

  // Manual amount
  if (d.manual_amount !== undefined) {
    setClauses.push('manual_amount = ?');
    setBinds.push(d.manual_amount);
    changes.manual_amount = { old: item.manual_amount, new: d.manual_amount };
  }

  // Override reason
  if (d.override_reason !== undefined) {
    setClauses.push('override_reason = ?');
    setBinds.push(d.override_reason);
  }
  if (d.override_reason_category !== undefined) {
    setClauses.push('override_reason_category = ?');
    setBinds.push(d.override_reason_category);
  }

  // Note
  if (d.note !== undefined) {
    setClauses.push('note = ?');
    setBinds.push(d.note);
  }

  // Vendor name
  if (d.vendor_name !== undefined) {
    setClauses.push('vendor_name = ?');
    setBinds.push(d.vendor_name);
  }

  // Evidence
  if (d.evidence_file_key !== undefined) {
    setClauses.push('evidence_file_key = ?');
    setBinds.push(d.evidence_file_key);
  }

  // Review status
  if (d.review_status !== undefined) {
    setClauses.push('review_status = ?');
    setBinds.push(d.review_status);
    changes.review_status = { old: item.review_status, new: d.review_status };
    if (d.review_status === 'confirmed') {
      setClauses.push('reviewed_by = ?', 'reviewed_at = datetime(?)');
      setBinds.push(user.id, 'now');
    }
  }

  // Recalculate final_amount from manual overrides
  const newManualQty = d.manual_quantity !== undefined ? d.manual_quantity : item.manual_quantity;
  const newManualPrice = d.manual_unit_price !== undefined ? d.manual_unit_price : item.manual_unit_price;
  const newManualAmount = d.manual_amount !== undefined ? d.manual_amount : item.manual_amount;

  let newFinalAmount: number;
  if (newManualAmount !== null && newManualAmount !== undefined) {
    newFinalAmount = newManualAmount;
  } else if (newManualQty !== null || newManualPrice !== null) {
    const qty = newManualQty ?? item.auto_quantity ?? 0;
    const price = newManualPrice ?? item.auto_unit_price ?? 0;
    newFinalAmount = Math.round(qty * price);
  } else {
    newFinalAmount = item.auto_amount ?? 0;
  }

  const newFinalQty = newManualQty ?? item.auto_quantity;
  const newFinalPrice = newManualPrice ?? item.auto_unit_price;

  if (newFinalAmount !== item.final_amount || newFinalQty !== item.final_quantity || newFinalPrice !== item.final_unit_price) {
    setClauses.push('final_quantity = ?', 'final_unit_price = ?', 'final_amount = ?');
    setBinds.push(newFinalQty, newFinalPrice, newFinalAmount);
    changes.final_amount = { old: item.final_amount, new: newFinalAmount };
  }

  // Version increment
  setClauses.push('version = version + 1');
  setClauses.push("updated_at = datetime('now')");

  // === SAME TX: Item update ===
  stmts.push(
    db.prepare(`UPDATE project_cost_items SET ${setClauses.join(', ')} WHERE id = ?`).bind(...setBinds, itemId)
  );

  // === SAME TX: Category summary recalculation ===
  stmts.push(db.prepare(`
    UPDATE project_cost_summaries SET
      final_total_amount = (
        SELECT COALESCE(SUM(final_amount), 0) FROM project_cost_items 
        WHERE project_id = ? AND snapshot_id = ? AND category_code = ? AND is_selected = 1
      ),
      auto_total_amount = (
        SELECT COALESCE(SUM(auto_amount), 0) FROM project_cost_items 
        WHERE project_id = ? AND snapshot_id = ? AND category_code = ? AND is_selected = 1
      ),
      manual_adjustment_amount = (
        SELECT COALESCE(SUM(final_amount), 0) - COALESCE(SUM(auto_amount), 0) FROM project_cost_items 
        WHERE project_id = ? AND snapshot_id = ? AND category_code = ? AND is_selected = 1
      ),
      updated_at = datetime('now')
    WHERE project_id = ? AND category_code = ?
  `).bind(
    projectId, project.current_snapshot_id, item.category_code,
    projectId, project.current_snapshot_id, item.category_code,
    projectId, project.current_snapshot_id, item.category_code,
    projectId, item.category_code
  ));

  // === SAME TX: Snapshot total recalculation ===
  stmts.push(db.prepare(`
    UPDATE project_cost_snapshots SET
      total_cost = (SELECT COALESCE(SUM(final_total_amount), 0) FROM project_cost_summaries WHERE project_id = ?),
      total_standard_cost = (
        SELECT COALESCE(SUM(s.final_total_amount), 0)
        FROM project_cost_summaries s JOIN cost_categories c ON c.category_code = s.category_code
        WHERE s.project_id = ? AND c.gross_margin_group = 'standard'
      ),
      total_solar_cost = (
        SELECT COALESCE(SUM(s.final_total_amount), 0)
        FROM project_cost_summaries s JOIN cost_categories c ON c.category_code = s.category_code
        WHERE s.project_id = ? AND c.gross_margin_group = 'solar'
      ),
      total_option_cost = (
        SELECT COALESCE(SUM(s.final_total_amount), 0)
        FROM project_cost_summaries s JOIN cost_categories c ON c.category_code = s.category_code
        WHERE s.project_id = ? AND c.gross_margin_group = 'option'
      )
    WHERE id = ?
  `).bind(projectId, projectId, projectId, projectId, project.current_snapshot_id));

  // === SAME TX: Audit log ===
  stmts.push(db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, before_value, after_value, field_name, changed_by, changed_at)
    VALUES (?, 'override', 'cost_item', ?, ?, ?, 'manual_update', ?, datetime('now'))
  `).bind(
    projectId, String(itemId),
    JSON.stringify({ final_amount: item.final_amount, review_status: item.review_status, version: item.version }),
    JSON.stringify(changes),
    user.id
  ));

  // === SAME TX: Generate warning if significant manual override ===
  if (changes.final_amount) {
    const pct = item.final_amount ? ((newFinalAmount - item.final_amount) / Math.abs(item.final_amount)) * 100 : 100;
    if (Math.abs(pct) >= 20) {
      stmts.push(db.prepare(`
        INSERT INTO project_warnings (
          project_id, snapshot_id, category_code, master_item_id,
          warning_type, severity, message, recommendation, detail_json,
          source, status, is_resolved, created_at
        ) VALUES (?, ?, ?, ?, 'threshold_exceeded', 'warning', ?, '確認してください', ?, 'system', 'open', 0, datetime('now'))
      `).bind(
        projectId, project.current_snapshot_id, item.category_code, item.master_item_id,
        `${item.item_name}: 手修正により ${Math.round(pct)}% の変動 (${item.final_amount}→${newFinalAmount})`,
        JSON.stringify({ old_amount: item.final_amount, new_amount: newFinalAmount, change_percent: Math.round(pct) })
      ));
    }
  }

  // === SAME TX: Increment project revision_no ===
  stmts.push(db.prepare(`
    UPDATE projects SET revision_no = revision_no + 1, updated_at = datetime('now') WHERE id = ?
  `).bind(projectId));

  // Execute all in single batch TX
  await db.batch(stmts);

  // Fetch updated item + summary + snapshot + project
  const updatedItem = await db.prepare('SELECT * FROM project_cost_items WHERE id = ?').bind(itemId).first();
  const updatedSummary = await db.prepare(
    'SELECT * FROM project_cost_summaries WHERE project_id = ? AND category_code = ?'
  ).bind(projectId, item.category_code).first();
  const updatedSnapshot = await db.prepare(
    'SELECT total_cost, total_standard_cost, total_solar_cost, total_option_cost FROM project_cost_snapshots WHERE id = ?'
  ).bind(project.current_snapshot_id).first();
  const updatedProject = await db.prepare(
    'SELECT revision_no FROM projects WHERE id = ?'
  ).bind(projectId).first() as any;

  // Count warnings for this snapshot
  const warningCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM project_warnings WHERE project_id = ? AND snapshot_id = ? AND status = 'open'"
  ).bind(projectId, project.current_snapshot_id).first() as any;

  return c.json({
    success: true,
    data: {
      item: updatedItem,
      category_summary: updatedSummary,
      snapshot_totals: updatedSnapshot,
      changes,
      project_revision_no: updatedProject?.revision_no,
      open_warnings_count: warningCount?.cnt || 0,
    },
  });
});

// ==========================================================
// POST /api/projects/:id/cost-items/:itemId/review
// 権限: admin, manager
// Body: { review_status: 'confirmed' | 'needs_review' | 'flagged', comment? }
// ==========================================================
costItemRoutes.post('/:id/cost-items/:itemId/review', requireRole('admin', 'manager'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));
  const itemId = parseInt(c.req.param('itemId'));
  if (isNaN(projectId) || isNaN(itemId)) { const err = validationError('Invalid IDs'); return c.json(err.body, err.status); }

  const body = await c.req.json();
  const parsed = ReviewTransitionSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const project = await db.prepare('SELECT id, current_snapshot_id FROM projects WHERE id = ?').bind(projectId).first() as any;
  if (!project?.current_snapshot_id) { const err = businessRuleError('No active snapshot'); return c.json(err.body, err.status); }

  const item = await db.prepare(
    'SELECT * FROM project_cost_items WHERE id = ? AND project_id = ? AND snapshot_id = ?'
  ).bind(itemId, projectId, project.current_snapshot_id).first() as any;
  if (!item) { const err = notFoundError('Cost item', itemId); return c.json(err.body, err.status); }

  const d = parsed.data;
  const stmts: D1PreparedStatement[] = [];

  stmts.push(db.prepare(`
    UPDATE project_cost_items SET
      review_status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
      version = version + 1, updated_at = datetime('now')
    WHERE id = ?
  `).bind(d.review_status, user.id, itemId));

  // Audit
  stmts.push(db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, before_value, after_value, field_name, changed_by, changed_at)
    VALUES (?, 'review', 'cost_item', ?, ?, ?, 'review_status', ?, datetime('now'))
  `).bind(
    projectId, String(itemId),
    JSON.stringify({ review_status: item.review_status }),
    JSON.stringify({ review_status: d.review_status, comment: d.comment }),
    user.id
  ));

  // Update snapshot confirmed_count
  stmts.push(db.prepare(`
    UPDATE project_cost_snapshots SET
      confirmed_count = (
        SELECT COUNT(*) FROM project_cost_items 
        WHERE project_id = ? AND snapshot_id = ? AND review_status = 'confirmed'
      )
    WHERE id = ?
  `).bind(projectId, project.current_snapshot_id, project.current_snapshot_id));

  await db.batch(stmts);

  const updated = await db.prepare('SELECT * FROM project_cost_items WHERE id = ?').bind(itemId).first();

  return c.json({ success: true, data: updated });
});

export default costItemRoutes;
