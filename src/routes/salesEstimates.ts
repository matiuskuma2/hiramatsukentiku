// ==============================================
// Sales Estimate Comparison API (Step 4.1)
//
// CRUD for project_sales_estimates
// Gap calculation (cost vs sale price)
// Warning generation: sales_estimate_gap
// Thresholds from system_settings:
//   sales_gap_warning_threshold = 10%
//   sales_gap_error_threshold = 20%
//   default_standard_margin_rate = 30%
//   default_solar_margin_rate = 25%
//   default_option_margin_rate = 30%
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import {
  validationError, notFoundError, businessRuleError, conflictError,
} from '../lib/errors';
import { EstimateType } from '../schemas/enums';
import { z } from 'zod';

const salesEstimateRoutes = new Hono<AppEnv>();
salesEstimateRoutes.use('*', resolveUser);

// === Zod schema for sales estimate creation/update ===
const CreateSalesEstimateSchema = z.object({
  estimate_type: EstimateType,
  total_sale_price: z.number().min(0),
  standard_sale: z.number().min(0).optional().default(0),
  solar_sale: z.number().min(0).optional().default(0),
  option_sale: z.number().min(0).optional().default(0),
  discount_amount: z.number().min(0).optional().default(0),
  tax_amount: z.number().min(0).optional().default(0),
  gross_margin_rate: z.number().optional(),
  note: z.string().max(1000).optional(),
  detail_json: z.string().optional(),
});

const UpdateSalesEstimateSchema = z.object({
  total_sale_price: z.number().min(0).optional(),
  standard_sale: z.number().min(0).optional(),
  solar_sale: z.number().min(0).optional(),
  option_sale: z.number().min(0).optional(),
  discount_amount: z.number().min(0).optional(),
  tax_amount: z.number().min(0).optional(),
  gross_margin_rate: z.number().optional(),
  note: z.string().max(1000).optional(),
  detail_json: z.string().optional(),
}).refine(data => Object.values(data).some(v => v !== undefined), {
  message: 'At least one field must be provided for update',
});

// ==========================================================
// Helper: Fetch system thresholds
// ==========================================================
async function getThresholds(db: D1Database) {
  const settings = await db.prepare(`
    SELECT setting_key, setting_value, value_type FROM system_settings
    WHERE setting_key IN (
      'sales_gap_warning_threshold',
      'sales_gap_error_threshold',
      'default_standard_margin_rate',
      'default_solar_margin_rate',
      'default_option_margin_rate'
    )
  `).all() as any;

  const result: Record<string, number> = {
    sales_gap_warning_threshold: 10,
    sales_gap_error_threshold: 20,
    default_standard_margin_rate: 30,
    default_solar_margin_rate: 25,
    default_option_margin_rate: 30,
  };

  for (const s of (settings.results || [])) {
    result[s.setting_key] = parseFloat(s.setting_value);
  }
  return result;
}

// ==========================================================
// Helper: Calculate gap analysis between cost and sale price
// ==========================================================
// ==========================================================
// Gap Analysis Types & Severity Decision Rules
// ==========================================================
// 乖離率の定義:
//   margin_deviation = expected_margin - actual_margin
//   正の値 = 期待粗利率を下回っている（マージン不足）
//   負の値 = 期待粗利率を上回っている（高マージン）
//
// 判定ロジック:
//   1. actual_margin < 0 (赤字: 売価 < 原価) → severity = 'error'
//   2. margin_deviation >= sales_gap_error_threshold (default 20%) → severity = 'error'
//      例: 期待30%, 実績8%, deviation=22 → error
//   3. margin_deviation >= sales_gap_warning_threshold (default 10%) → severity = 'warning'
//      例: 期待30%, 実績18%, deviation=12 → warning
//   4. それ以外 → severity = 'ok'
//      例: 期待30%, 実績44%, deviation=-14 → ok (高マージン)
//      例: 期待30%, 実績25%, deviation=5 → ok (閾値内)
//
// テストケース例:
//   原価 2,881,290 / 売価 5,200,000 → margin 44.59%, deviation -14.59 → ok
//   原価 2,881,290 / 売価 3,200,000 → margin 9.96%,  deviation 20.04 → error
//   原価 2,881,290 / 売価 3,800,000 → margin 24.15%, deviation 5.85  → ok
//   原価 2,881,290 / 売価 3,500,000 → margin 17.68%, deviation 12.32 → warning
//   原価 2,881,290 / 売価 2,500,000 → margin -15.25%, (赤字)       → error
// ==========================================================
interface GapGroupDetail {
  cost: number;
  sale: number;
  gap_amount: number;
  gap_percent: number;
  expected_margin: number;
  actual_margin: number;
}

interface GapAnalysis {
  total_cost: number;
  total_sale_price: number;
  gap_amount: number;
  gap_percent: number;
  standard_gap: GapGroupDetail;
  solar_gap: GapGroupDetail;
  option_gap: GapGroupDetail;
  overall_margin_rate: number;
  expected_margin_rate: number;
  margin_deviation: number;
  severity: 'ok' | 'warning' | 'error';
  severity_reason: string;
  thresholds: Record<string, number>;
}

function calculateGap(
  snapshot: any,
  estimate: any,
  thresholds: Record<string, number>
): GapAnalysis {
  const totalCost = snapshot.total_cost || 0;
  const totalSale = estimate.total_sale_price || 0;
  const standardCost = snapshot.total_standard_cost || 0;
  const solarCost = snapshot.total_solar_cost || 0;
  const optionCost = snapshot.total_option_cost || 0;
  const standardSale = estimate.standard_sale || 0;
  const solarSale = estimate.solar_sale || 0;
  const optionSale = estimate.option_sale || 0;

  const gapAmount = totalSale - totalCost;
  const gapPercent = totalCost > 0 ? (gapAmount / totalCost) * 100 : 0;
  const overallMargin = totalSale > 0 ? ((totalSale - totalCost) / totalSale) * 100 : 0;

  // Per-group calculations
  const calcGroup = (cost: number, sale: number, expectedMargin: number) => {
    const gap = sale - cost;
    const pct = cost > 0 ? (gap / cost) * 100 : 0;
    const actualMargin = sale > 0 ? ((sale - cost) / sale) * 100 : 0;
    return { cost, sale, gap_amount: Math.round(gap), gap_percent: Math.round(pct * 100) / 100, expected_margin: expectedMargin, actual_margin: Math.round(actualMargin * 100) / 100 };
  };

  const standardGap = calcGroup(standardCost, standardSale, thresholds.default_standard_margin_rate);
  const solarGap = calcGroup(solarCost, solarSale, thresholds.default_solar_margin_rate);
  const optionGap = calcGroup(optionCost, optionSale, thresholds.default_option_margin_rate);

  // Determine severity: compare actual margin vs expected
  // margin_deviation > 0 = below expected, < 0 = above expected
  const expectedOverallMargin = thresholds.default_standard_margin_rate;
  const marginDeviation = Math.round((expectedOverallMargin - overallMargin) * 100) / 100;

  let severity: 'ok' | 'warning' | 'error' = 'ok';
  let severityReason = 'マージン閾値内';

  // Priority 1: 赤字チェック
  if (totalSale > 0 && totalSale < totalCost) {
    severity = 'error';
    severityReason = `赤字: 売価(${totalSale}) < 原価(${totalCost})`;
  }
  // Priority 2: エラー閾値
  else if (marginDeviation >= thresholds.sales_gap_error_threshold) {
    severity = 'error';
    severityReason = `マージン不足(error): 乖離${marginDeviation}% >= 閾値${thresholds.sales_gap_error_threshold}%`;
  }
  // Priority 3: 警告閾値
  else if (marginDeviation >= thresholds.sales_gap_warning_threshold) {
    severity = 'warning';
    severityReason = `マージン注意(warning): 乖離${marginDeviation}% >= 閾値${thresholds.sales_gap_warning_threshold}%`;
  }
  // Priority 4: OK（高マージン含む）
  else {
    severityReason = marginDeviation < 0
      ? `高マージン: 期待${expectedOverallMargin}%を${Math.abs(marginDeviation)}%上回る`
      : `マージン閾値内: 乖離${marginDeviation}% < 閾値${thresholds.sales_gap_warning_threshold}%`;
  }

  return {
    total_cost: Math.round(totalCost),
    total_sale_price: Math.round(totalSale),
    gap_amount: Math.round(gapAmount),
    gap_percent: Math.round(gapPercent * 100) / 100,
    standard_gap: standardGap,
    solar_gap: solarGap,
    option_gap: optionGap,
    overall_margin_rate: Math.round(overallMargin * 100) / 100,
    expected_margin_rate: expectedOverallMargin,
    margin_deviation: marginDeviation,
    severity,
    severity_reason: severityReason,
    thresholds,
  };
}

// ==========================================================
// Helper: Generate/update sales_estimate_gap warning
// ==========================================================
async function generateSalesGapWarning(
  db: D1Database,
  projectId: number,
  snapshotId: number,
  gap: GapAnalysis,
  userId: number,
): Promise<number> {
  if (gap.severity === 'ok') {
    // Resolve any existing open sales_estimate_gap warnings
    await db.prepare(`
      UPDATE project_warnings SET 
        status = 'resolved', is_resolved = 1, 
        resolved_by = ?, resolved_at = datetime('now'),
        resolved_note = 'Gap within acceptable threshold'
      WHERE project_id = ? AND snapshot_id = ? AND warning_type = 'sales_estimate_gap' AND status = 'open'
    `).bind(userId, projectId, snapshotId).run();
    return 0;
  }

  // Check if a sales_estimate_gap warning already exists for this snapshot
  const existing = await db.prepare(`
    SELECT id FROM project_warnings 
    WHERE project_id = ? AND snapshot_id = ? AND warning_type = 'sales_estimate_gap' AND status = 'open'
  `).bind(projectId, snapshotId).first();

  const warningSeverity = gap.severity === 'error' ? 'error' : 'warning';
  const message = gap.severity === 'error'
    ? `売価と原価の乖離が大きいです: 粗利率 ${gap.overall_margin_rate}% (期待 ${gap.thresholds.default_standard_margin_rate}%, 乖離 ${gap.thresholds.sales_gap_error_threshold}% 超)`
    : `売価と原価の乖離に注意: 粗利率 ${gap.overall_margin_rate}% (期待 ${gap.thresholds.default_standard_margin_rate}%, 乖離 ${gap.thresholds.sales_gap_warning_threshold}% 超)`;
  const recommendation = gap.severity === 'error'
    ? '原価見直しまたは売価の再設定が必要です'
    : '売価設定を確認してください';

  const detailJson = JSON.stringify({
    total_cost: gap.total_cost,
    total_sale_price: gap.total_sale_price,
    gap_amount: gap.gap_amount,
    gap_percent: gap.gap_percent,
    overall_margin_rate: gap.overall_margin_rate,
    standard_gap: gap.standard_gap,
    solar_gap: gap.solar_gap,
    option_gap: gap.option_gap,
    thresholds: gap.thresholds,
  });

  if (existing) {
    // Update existing warning
    await db.prepare(`
      UPDATE project_warnings SET 
        severity = ?, message = ?, recommendation = ?, detail_json = ?,
        status = 'open', is_resolved = 0, resolved_by = NULL, resolved_at = NULL, resolved_note = NULL
      WHERE id = ?
    `).bind(warningSeverity, message, recommendation, detailJson, (existing as any).id).run();
    return 0;
  } else {
    // Insert new warning
    await db.prepare(`
      INSERT INTO project_warnings (
        project_id, snapshot_id, category_code, master_item_id,
        warning_type, severity, message, recommendation, detail_json,
        source, status, is_resolved, created_at
      ) VALUES (?, ?, NULL, NULL, 'sales_estimate_gap', ?, ?, ?, ?, 'system', 'open', 0, datetime('now'))
    `).bind(projectId, snapshotId, warningSeverity, message, recommendation, detailJson).run();

    // Update snapshot warning_count
    await db.prepare(`
      UPDATE project_cost_snapshots SET warning_count = (
        SELECT COUNT(*) FROM project_warnings WHERE project_id = ? AND snapshot_id = ? AND status = 'open'
      ) WHERE id = ?
    `).bind(projectId, snapshotId, snapshotId).run();

    return 1;
  }
}

// ==========================================================
// POST /api/projects/:id/sales-estimates
// Create a new sales estimate + gap calculation + warning
// 権限: admin, manager, estimator
// ==========================================================
salesEstimateRoutes.post('/:id/sales-estimates', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const body = await c.req.json();
  const parsed = CreateSalesEstimateSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  // Fetch project + snapshot
  const project = await db.prepare('SELECT id, current_snapshot_id, status FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) { const err = notFoundError('Project', projectId); return c.json(err.body, err.status); }
  if (!project.current_snapshot_id) {
    const err = businessRuleError('Project has no active snapshot. Create a snapshot first before adding sales estimates.');
    return c.json(err.body, err.status);
  }

  const snapshot = await db.prepare(
    'SELECT * FROM project_cost_snapshots WHERE id = ? AND project_id = ?'
  ).bind(project.current_snapshot_id, projectId).first() as any;
  if (!snapshot) { const err = notFoundError('Snapshot', project.current_snapshot_id); return c.json(err.body, err.status); }

  const d = parsed.data;

  // Deactivate previous current estimates of same type
  await db.prepare(`
    UPDATE project_sales_estimates SET is_current = 0, updated_at = datetime('now')
    WHERE project_id = ? AND estimate_type = ? AND is_current = 1
  `).bind(projectId, d.estimate_type).run();

  // Calculate costs from snapshot for the estimate
  const totalCost = snapshot.total_cost || 0;
  const grossMarginRate = d.total_sale_price > 0
    ? ((d.total_sale_price - totalCost) / d.total_sale_price) * 100
    : 0;

  // Insert new estimate
  const result = await db.prepare(`
    INSERT INTO project_sales_estimates (
      project_id, snapshot_id, estimate_type,
      total_cost, total_sale_price, gross_margin_rate,
      discount_amount, tax_amount,
      standard_cost, standard_sale,
      solar_cost, solar_sale,
      option_cost, option_sale,
      note, detail_json, is_current,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
  `).bind(
    projectId, project.current_snapshot_id, d.estimate_type,
    totalCost, d.total_sale_price, Math.round(grossMarginRate * 100) / 100,
    d.discount_amount || 0, d.tax_amount || 0,
    snapshot.total_standard_cost || 0, d.standard_sale || 0,
    snapshot.total_solar_cost || 0, d.solar_sale || 0,
    snapshot.total_option_cost || 0, d.option_sale || 0,
    d.note || null, d.detail_json || null,
    user.id,
  ).run();

  const estimateId = result.meta.last_row_id;

  // Gap analysis
  const thresholds = await getThresholds(db);
  const gap = calculateGap(snapshot, { ...d }, thresholds);

  // Generate warning if gap exceeds threshold
  const warningsCreated = await generateSalesGapWarning(db, projectId, project.current_snapshot_id, gap, user.id);

  // Update snapshot estimated_sale_price
  await db.prepare(`
    UPDATE project_cost_snapshots SET 
      estimated_sale_price = ?, overall_margin_rate = ?
    WHERE id = ?
  `).bind(d.total_sale_price, Math.round(grossMarginRate * 100) / 100, project.current_snapshot_id).run();

  // Audit log
  await db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, after_value, changed_by, changed_at)
    VALUES (?, 'create', 'sales_estimate', ?, ?, ?, datetime('now'))
  `).bind(
    projectId, String(estimateId),
    JSON.stringify({ estimate_type: d.estimate_type, total_sale_price: d.total_sale_price, gap: gap }),
    user.id,
  ).run();

  // Fetch created estimate
  const estimate = await db.prepare('SELECT * FROM project_sales_estimates WHERE id = ?').bind(estimateId).first();

  return c.json({
    success: true,
    data: {
      estimate,
      gap_analysis: gap,
      warnings_created: warningsCreated,
    },
  } satisfies ApiResponse, 201);
});

// ==========================================================
// GET /api/projects/:id/sales-estimates
// List all sales estimates for project
// Query: ?estimate_type=rough&current_only=true
// ==========================================================
salesEstimateRoutes.get('/:id/sales-estimates', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const estimateType = c.req.query('estimate_type');
  const currentOnly = c.req.query('current_only') === 'true';

  let sql = 'SELECT * FROM project_sales_estimates WHERE project_id = ?';
  const binds: any[] = [projectId];

  if (estimateType) { sql += ' AND estimate_type = ?'; binds.push(estimateType); }
  if (currentOnly) { sql += ' AND is_current = 1'; }

  sql += ' ORDER BY created_at DESC';

  const result = await db.prepare(sql).bind(...binds).all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  });
});

// ==========================================================
// GET /api/projects/:id/sales-estimates/:estimateId
// Get specific estimate with gap analysis
// ==========================================================
salesEstimateRoutes.get('/:id/sales-estimates/:estimateId', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  const estimateId = parseInt(c.req.param('estimateId'));
  if (isNaN(projectId) || isNaN(estimateId)) { const err = validationError('Invalid IDs'); return c.json(err.body, err.status); }

  const estimate = await db.prepare(
    'SELECT * FROM project_sales_estimates WHERE id = ? AND project_id = ?'
  ).bind(estimateId, projectId).first() as any;
  if (!estimate) { const err = notFoundError('Sales estimate', estimateId); return c.json(err.body, err.status); }

  const snapshot = await db.prepare(
    'SELECT * FROM project_cost_snapshots WHERE id = ?'
  ).bind(estimate.snapshot_id).first() as any;

  let gap: GapAnalysis | null = null;
  if (snapshot) {
    const thresholds = await getThresholds(db);
    gap = calculateGap(snapshot, estimate, thresholds);
  }

  return c.json({
    success: true,
    data: { estimate, gap_analysis: gap },
  });
});

// ==========================================================
// PATCH /api/projects/:id/sales-estimates/:estimateId
// Update sales estimate + recalculate gap + update warning
// 権限: admin, manager, estimator
// ==========================================================
salesEstimateRoutes.patch('/:id/sales-estimates/:estimateId', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const projectId = parseInt(c.req.param('id'));
  const estimateId = parseInt(c.req.param('estimateId'));
  if (isNaN(projectId) || isNaN(estimateId)) { const err = validationError('Invalid IDs'); return c.json(err.body, err.status); }

  const body = await c.req.json();
  const parsed = UpdateSalesEstimateSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const estimate = await db.prepare(
    'SELECT * FROM project_sales_estimates WHERE id = ? AND project_id = ?'
  ).bind(estimateId, projectId).first() as any;
  if (!estimate) { const err = notFoundError('Sales estimate', estimateId); return c.json(err.body, err.status); }

  const project = await db.prepare('SELECT current_snapshot_id FROM projects WHERE id = ?').bind(projectId).first() as any;

  const d = parsed.data;
  const setClauses: string[] = [];
  const setBinds: any[] = [];

  if (d.total_sale_price !== undefined) { setClauses.push('total_sale_price = ?'); setBinds.push(d.total_sale_price); }
  if (d.standard_sale !== undefined) { setClauses.push('standard_sale = ?'); setBinds.push(d.standard_sale); }
  if (d.solar_sale !== undefined) { setClauses.push('solar_sale = ?'); setBinds.push(d.solar_sale); }
  if (d.option_sale !== undefined) { setClauses.push('option_sale = ?'); setBinds.push(d.option_sale); }
  if (d.discount_amount !== undefined) { setClauses.push('discount_amount = ?'); setBinds.push(d.discount_amount); }
  if (d.tax_amount !== undefined) { setClauses.push('tax_amount = ?'); setBinds.push(d.tax_amount); }
  if (d.gross_margin_rate !== undefined) { setClauses.push('gross_margin_rate = ?'); setBinds.push(d.gross_margin_rate); }
  if (d.note !== undefined) { setClauses.push('note = ?'); setBinds.push(d.note); }
  if (d.detail_json !== undefined) { setClauses.push('detail_json = ?'); setBinds.push(d.detail_json); }

  // Recalculate margin if sale price changed
  const newSalePrice = d.total_sale_price ?? estimate.total_sale_price;
  const totalCost = estimate.total_cost || 0;
  const newMargin = newSalePrice > 0 ? ((newSalePrice - totalCost) / newSalePrice) * 100 : 0;
  setClauses.push('gross_margin_rate = ?');
  setBinds.push(Math.round(newMargin * 100) / 100);

  setClauses.push("updated_at = datetime('now')");

  await db.prepare(
    `UPDATE project_sales_estimates SET ${setClauses.join(', ')} WHERE id = ?`
  ).bind(...setBinds, estimateId).run();

  // Refetch and recalculate gap
  const updated = await db.prepare('SELECT * FROM project_sales_estimates WHERE id = ?').bind(estimateId).first() as any;
  const snapshot = await db.prepare('SELECT * FROM project_cost_snapshots WHERE id = ?').bind(estimate.snapshot_id).first() as any;

  let gap: GapAnalysis | null = null;
  if (snapshot) {
    const thresholds = await getThresholds(db);
    gap = calculateGap(snapshot, updated, thresholds);

    // Update/create warning
    await generateSalesGapWarning(db, projectId, estimate.snapshot_id, gap, user.id);

    // Update snapshot sale price
    if (estimate.is_current && d.total_sale_price !== undefined) {
      await db.prepare(`
        UPDATE project_cost_snapshots SET 
          estimated_sale_price = ?, overall_margin_rate = ?
        WHERE id = ?
      `).bind(newSalePrice, Math.round(newMargin * 100) / 100, estimate.snapshot_id).run();
    }
  }

  // Audit
  await db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, before_value, after_value, changed_by, changed_at)
    VALUES (?, 'update', 'sales_estimate', ?, ?, ?, ?, datetime('now'))
  `).bind(
    projectId, String(estimateId),
    JSON.stringify({ total_sale_price: estimate.total_sale_price, gross_margin_rate: estimate.gross_margin_rate }),
    JSON.stringify({ total_sale_price: updated.total_sale_price, gross_margin_rate: updated.gross_margin_rate, gap }),
    user.id,
  ).run();

  return c.json({
    success: true,
    data: { estimate: updated, gap_analysis: gap },
  });
});

// ==========================================================
// GET /api/projects/:id/gap-analysis
// Convenience: current estimate vs current snapshot
// ==========================================================
salesEstimateRoutes.get('/:id/gap-analysis', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const project = await db.prepare('SELECT id, current_snapshot_id FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) { const err = notFoundError('Project', projectId); return c.json(err.body, err.status); }
  if (!project.current_snapshot_id) {
    const err = businessRuleError('No active snapshot');
    return c.json(err.body, err.status);
  }

  const snapshot = await db.prepare(
    'SELECT * FROM project_cost_snapshots WHERE id = ?'
  ).bind(project.current_snapshot_id).first() as any;

  // Find current estimate (prefer rough → internal → contract → execution)
  const estimate = await db.prepare(`
    SELECT * FROM project_sales_estimates 
    WHERE project_id = ? AND is_current = 1 
    ORDER BY CASE estimate_type 
      WHEN 'rough' THEN 1 WHEN 'internal' THEN 2 
      WHEN 'contract' THEN 3 WHEN 'execution' THEN 4 
    END ASC
    LIMIT 1
  `).bind(projectId).first() as any;

  if (!estimate) {
    return c.json({
      success: true,
      data: {
        has_estimate: false,
        snapshot_cost: snapshot?.total_cost || 0,
        message: 'No sales estimate found. Create one to see gap analysis.',
      },
    });
  }

  const thresholds = await getThresholds(db);
  const gap = calculateGap(snapshot, estimate, thresholds);

  return c.json({
    success: true,
    data: {
      has_estimate: true,
      estimate_id: estimate.id,
      estimate_type: estimate.estimate_type,
      gap_analysis: gap,
    },
  });
});

export default salesEstimateRoutes;
