// ==============================================
// Risk Centre API (Step 4.2)
// UX-01/06/07 of 16_UX_RISK_PREVENTION_DESIGN
//
// Single endpoint: GET /api/projects/:id/risk-centre
// Returns aggregated risk summary:
//   1. unset_conditions — missing project input fields
//   2. unresolved_diffs — pending regeneration diffs
//   3. sales_gap — deviation from deal amount
//   4. ai_warnings — AI-generated warnings
//   5. general_notices — system + regeneration warnings
//   6. input_completion_rate — % of required fields filled
//   7. review_progress — confirmed vs total items
//   8. summary — overall risk score & action items
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser } from '../middleware/auth';
import { validationError, notFoundError, businessRuleError } from '../lib/errors';

const riskCentreRoutes = new Hono<AppEnv>();
riskCentreRoutes.use('*', resolveUser);

// Required fields for cost estimation
// NOTE: lineup is handled separately with special null/CUSTOM logic
const REQUIRED_FIELDS = [
  { field: 'tsubo', label: '坪数', category: 'area' },
  { field: 'building_area_m2', label: '建築面積(m²)', category: 'area' },
  { field: 'total_floor_area_m2', label: '延床面積(m²)', category: 'area' },
  { field: 'insulation_grade', label: '断熱等級', category: 'spec' },
  { field: 'roof_shape', label: '屋根形状', category: 'spec' },
  { field: 'fire_zone_type', label: '防火地域区分', category: 'spec' },
  { field: 'has_wb', label: 'WB工法有無', category: 'spec' },
];

// Optional but recommended fields
const RECOMMENDED_FIELDS = [
  { field: 'customer_name', label: '顧客名', category: 'basic' },
  { field: 'prefecture', label: '都道府県', category: 'location' },
  { field: 'city', label: '市区町村', category: 'location' },
  { field: 'pv_kw', label: 'PV容量(kW)', category: 'solar' },
  { field: 'battery_kwh', label: '蓄電池容量(kWh)', category: 'solar' },
  { field: 'standard_margin_rate', label: '標準粗利率', category: 'financial' },
  { field: 'solar_margin_rate', label: '太陽光粗利率', category: 'financial' },
  { field: 'option_margin_rate', label: 'オプション粗利率', category: 'financial' },
];

interface RiskItem {
  id: string;
  category: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  action_required: boolean;
  action_label?: string;
  detail?: any;
}

// ==========================================================
// GET /api/projects/:id/risk-centre
// ==========================================================
riskCentreRoutes.get('/:id/risk-centre', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('id'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first() as any;
  if (!project) { const err = notFoundError('Project', projectId); return c.json(err.body, err.status); }

  const risks: RiskItem[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  // ==== 0. Lineup-specific warnings ====
  const lineup = project.lineup;
  if (lineup === null || lineup === undefined || lineup === '') {
    // 未定
    risks.push({
      id: 'lineup_undecided',
      category: 'input',
      severity: 'warning',
      title: 'ラインナップ未定',
      description: 'ラインナップが未選択です。ラインナップ依存の工種（木工事等）は自動計算できず、手動入力が必要になります。ラインナップ確定後に再計算してください。',
      action_required: true,
      action_label: 'ラインナップを設定してください',
    });
    warningCount++;
  } else if (lineup === 'CUSTOM') {
    // オーダーメイド
    risks.push({
      id: 'lineup_custom',
      category: 'input',
      severity: 'info',
      title: 'オーダーメイド案件',
      description: 'オーダーメイド（シリーズ外）の案件です。ラインナップ依存の工種は全て手動入力が必要です。各工種の金額を業者見積もり等で確認してください。',
      action_required: false,
      action_label: '手動入力が必要な工種を確認',
    });
    infoCount++;
  }

  // ==== 1. Unset Conditions (Input Completeness) ====
  const unsetRequired: Array<{ field: string; label: string; category: string }> = [];
  const setRequired: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = project[f.field];
    if (v === null || v === undefined || v === '' || v === 0) {
      unsetRequired.push(f);
    } else {
      setRequired.push(f.field);
    }
  }
  // Count lineup as a required field for completion rate
  if (lineup && lineup !== '') {
    setRequired.push('lineup');
  } else {
    unsetRequired.push({ field: 'lineup', label: '商品ラインナップ', category: 'basic' });
  }

  const unsetRecommended: Array<{ field: string; label: string; category: string }> = [];
  const setRecommended: string[] = [];
  for (const f of RECOMMENDED_FIELDS) {
    const v = project[f.field];
    if (v === null || v === undefined || v === '' || v === 0) {
      unsetRecommended.push(f);
    } else {
      setRecommended.push(f.field);
    }
  }

  const totalFields = REQUIRED_FIELDS.length + RECOMMENDED_FIELDS.length;
  const filledFields = setRequired.length + setRecommended.length;
  const inputCompletionRate = Math.round((filledFields / totalFields) * 100);
  const requiredCompletionRate = REQUIRED_FIELDS.length > 0 
    ? Math.round((setRequired.length / REQUIRED_FIELDS.length) * 100) : 100;

  if (unsetRequired.length > 0) {
    const risk: RiskItem = {
      id: 'unset_required_conditions',
      category: 'input',
      severity: 'error',
      title: `必須入力項目が ${unsetRequired.length} 件未設定`,
      description: `未設定: ${unsetRequired.map(f => f.label).join('、')}`,
      action_required: true,
      action_label: 'プロジェクト設定を完了してください',
      detail: { unset_fields: unsetRequired, set_fields: setRequired },
    };
    risks.push(risk);
    errorCount++;
  }

  if (unsetRecommended.length > 0) {
    risks.push({
      id: 'unset_recommended_conditions',
      category: 'input',
      severity: 'info',
      title: `推奨入力項目が ${unsetRecommended.length} 件未設定`,
      description: `未設定: ${unsetRecommended.map(f => f.label).join('、')}`,
      action_required: false,
      detail: { unset_fields: unsetRecommended, set_fields: setRecommended },
    });
    infoCount++;
  }

  // ==== 2. Unresolved Regeneration Diffs ====
  let unresolvedDiffs = 0;
  let significantDiffs = 0;
  let totalChangeAmount = 0;
  if (project.current_snapshot_id) {
    const diffResult = await db.prepare(`
      SELECT 
        COUNT(*) as total_pending,
        SUM(CASE WHEN is_significant = 1 THEN 1 ELSE 0 END) as significant_count,
        SUM(COALESCE(change_amount, 0)) as total_change
      FROM project_cost_regeneration_diffs 
      WHERE project_id = ? AND resolution_status = 'pending'
    `).bind(projectId).first() as any;

    unresolvedDiffs = diffResult?.total_pending || 0;
    significantDiffs = diffResult?.significant_count || 0;
    totalChangeAmount = Math.round(diffResult?.total_change || 0);

    if (significantDiffs > 0) {
      risks.push({
        id: 'unresolved_significant_diffs',
        category: 'regeneration',
        severity: 'error',
        title: `重要な差分が ${significantDiffs} 件未解決`,
        description: `再生成で検出された重要差分（金額変動合計: ¥${totalChangeAmount.toLocaleString()}）`,
        action_required: true,
        action_label: '差分を確認・解決してください',
        detail: { pending: unresolvedDiffs, significant: significantDiffs, total_change: totalChangeAmount },
      });
      errorCount++;
    } else if (unresolvedDiffs > 0) {
      risks.push({
        id: 'unresolved_diffs',
        category: 'regeneration',
        severity: 'warning',
        title: `未解決の差分が ${unresolvedDiffs} 件`,
        description: `再生成で検出された差分（金額変動合計: ¥${totalChangeAmount.toLocaleString()}）`,
        action_required: true,
        action_label: '差分を確認してください',
        detail: { pending: unresolvedDiffs, significant: 0, total_change: totalChangeAmount },
      });
      warningCount++;
    }
  }

  // ==== 3. Sales Gap (Deal Amount Deviation) ====
  let salesGapData: any = null;
  if (project.current_snapshot_id) {
    const estimate = await db.prepare(`
      SELECT * FROM project_sales_estimates 
      WHERE project_id = ? AND is_current = 1 
      ORDER BY created_at DESC LIMIT 1
    `).bind(projectId).first() as any;

    if (estimate) {
      const snapshot = await db.prepare(
        'SELECT * FROM project_cost_snapshots WHERE id = ?'
      ).bind(project.current_snapshot_id).first() as any;

      if (snapshot) {
        const thresholds = await getThresholds(db);
        const totalCost = snapshot.total_cost || 0;
        const totalSale = estimate.total_sale_price || 0;
        const gapAmount = totalSale - totalCost;
        const overallMargin = totalSale > 0 ? ((totalSale - totalCost) / totalSale) * 100 : 0;
        const expectedMargin = thresholds.default_standard_margin_rate;
        const marginDeviation = expectedMargin - overallMargin;

        salesGapData = {
          estimate_type: estimate.estimate_type,
          total_cost: totalCost,
          total_sale_price: totalSale,
          gap_amount: Math.round(gapAmount),
          overall_margin_rate: Math.round(overallMargin * 100) / 100,
          expected_margin_rate: expectedMargin,
          margin_deviation: Math.round(marginDeviation * 100) / 100,
        };

        if (totalSale > 0 && totalSale < totalCost) {
          risks.push({
            id: 'sales_gap_negative_margin',
            category: 'sales',
            severity: 'error',
            title: '売価が原価を下回っています',
            description: `原価 ¥${totalCost.toLocaleString()} > 売価 ¥${totalSale.toLocaleString()} (差額: ¥${Math.abs(gapAmount).toLocaleString()})`,
            action_required: true,
            action_label: '売価または原価を見直してください',
            detail: salesGapData,
          });
          errorCount++;
        } else if (marginDeviation >= thresholds.sales_gap_error_threshold) {
          risks.push({
            id: 'sales_gap_error',
            category: 'sales',
            severity: 'error',
            title: `粗利率が大幅に不足: ${Math.round(overallMargin)}% (期待 ${expectedMargin}%)`,
            description: `乖離 ${Math.round(marginDeviation)}% — 閾値 ${thresholds.sales_gap_error_threshold}% を超過`,
            action_required: true,
            action_label: '売価設定を見直してください',
            detail: salesGapData,
          });
          errorCount++;
        } else if (marginDeviation >= thresholds.sales_gap_warning_threshold) {
          risks.push({
            id: 'sales_gap_warning',
            category: 'sales',
            severity: 'warning',
            title: `粗利率に注意: ${Math.round(overallMargin)}% (期待 ${expectedMargin}%)`,
            description: `乖離 ${Math.round(marginDeviation)}% — 閾値 ${thresholds.sales_gap_warning_threshold}% を超過`,
            action_required: false,
            detail: salesGapData,
          });
          warningCount++;
        }
      }
    } else {
      // No estimate at all
      risks.push({
        id: 'no_sales_estimate',
        category: 'sales',
        severity: 'info',
        title: '売価見積もりが未作成',
        description: '売価を入力すると、原価との乖離分析が表示されます',
        action_required: false,
        action_label: '初期見積額を入力してください',
      });
      infoCount++;
    }
  }

  // ==== 4. AI Warnings ====
  let aiWarnings: any[] = [];
  if (project.current_snapshot_id) {
    const aiResult = await db.prepare(`
      SELECT id, warning_type, severity, message, recommendation, detail_json, source, status
      FROM project_warnings 
      WHERE project_id = ? AND snapshot_id = ? AND source = 'ai' AND status = 'open'
      ORDER BY CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END
    `).bind(projectId, project.current_snapshot_id).all();
    aiWarnings = (aiResult.results || []) as any[];

    if (aiWarnings.length > 0) {
      const aiErrors = aiWarnings.filter(w => w.severity === 'error').length;
      const aiWarn = aiWarnings.filter(w => w.severity === 'warning').length;
      risks.push({
        id: 'ai_warnings',
        category: 'ai',
        severity: aiErrors > 0 ? 'error' : 'warning',
        title: `AI警告: ${aiWarnings.length} 件 (エラー ${aiErrors}, 注意 ${aiWarn})`,
        description: aiWarnings.slice(0, 3).map(w => w.message).join('; '),
        action_required: aiErrors > 0,
        action_label: 'AI指摘事項を確認してください',
        detail: { count: aiWarnings.length, errors: aiErrors, warnings: aiWarn, items: aiWarnings.slice(0, 5) },
      });
      if (aiErrors > 0) errorCount++;
      else warningCount++;
    }
  }

  // ==== 5. General Notices (system + regeneration warnings) ====
  let generalWarnings: any[] = [];
  if (project.current_snapshot_id) {
    const genResult = await db.prepare(`
      SELECT id, warning_type, severity, message, recommendation, source, status
      FROM project_warnings 
      WHERE project_id = ? AND snapshot_id = ? AND source IN ('system', 'regeneration', 'manual') AND status = 'open'
      ORDER BY CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END
    `).bind(projectId, project.current_snapshot_id).all();
    generalWarnings = (genResult.results || []) as any[];

    const sysErrors = generalWarnings.filter(w => w.severity === 'error').length;
    const sysWarnings = generalWarnings.filter(w => w.severity === 'warning').length;
    const manualRequired = generalWarnings.filter(w => w.warning_type === 'manual_required').length;

    if (manualRequired > 0) {
      risks.push({
        id: 'manual_required_items',
        category: 'system',
        severity: 'warning',
        title: `手動確認が必要な項目: ${manualRequired} 件`,
        description: generalWarnings.filter(w => w.warning_type === 'manual_required').slice(0, 3).map(w => w.message).join('; '),
        action_required: true,
        action_label: '手動入力が必要な明細を確認してください',
        detail: { count: manualRequired },
      });
      warningCount++;
    }

    if (sysErrors > 0) {
      risks.push({
        id: 'system_errors',
        category: 'system',
        severity: 'error',
        title: `システムエラー: ${sysErrors} 件`,
        description: generalWarnings.filter(w => w.severity === 'error').slice(0, 3).map(w => w.message).join('; '),
        action_required: true,
        action_label: 'エラーを確認してください',
        detail: { count: sysErrors },
      });
      errorCount++;
    }

    if (sysWarnings > manualRequired) {
      const otherWarnings = sysWarnings - manualRequired;
      risks.push({
        id: 'system_warnings',
        category: 'system',
        severity: 'warning',
        title: `システム警告: ${otherWarnings} 件`,
        description: '金額0円の項目、閾値超過などを確認してください',
        action_required: false,
        detail: { count: otherWarnings },
      });
      warningCount++;
    }
  }

  // ==== 6. Review Progress ====
  let reviewProgress = { total_items: 0, confirmed: 0, pending: 0, needs_review: 0, flagged: 0, rate: 0 };
  if (project.current_snapshot_id) {
    const reviewResult = await db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN review_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN review_status = 'needs_review' THEN 1 ELSE 0 END) as needs_review,
        SUM(CASE WHEN review_status = 'flagged' THEN 1 ELSE 0 END) as flagged
      FROM project_cost_items 
      WHERE project_id = ? AND snapshot_id = ?
    `).bind(projectId, project.current_snapshot_id).first() as any;

    reviewProgress = {
      total_items: reviewResult?.total || 0,
      confirmed: reviewResult?.confirmed || 0,
      pending: reviewResult?.pending || 0,
      needs_review: reviewResult?.needs_review || 0,
      flagged: reviewResult?.flagged || 0,
      rate: reviewResult?.total > 0 ? Math.round((reviewResult.confirmed / reviewResult.total) * 100) : 0,
    };

    if (reviewProgress.flagged > 0) {
      risks.push({
        id: 'flagged_items',
        category: 'review',
        severity: 'error',
        title: `フラグ付き項目: ${reviewProgress.flagged} 件`,
        description: '要確認のフラグが立っている明細があります',
        action_required: true,
        action_label: 'フラグ項目を確認してください',
        detail: reviewProgress,
      });
      errorCount++;
    }

    if (reviewProgress.needs_review > 0) {
      risks.push({
        id: 'needs_review_items',
        category: 'review',
        severity: 'warning',
        title: `レビュー待ち: ${reviewProgress.needs_review} 件`,
        description: 'レビューが必要な明細があります',
        action_required: false,
        detail: reviewProgress,
      });
      warningCount++;
    }
  }

  // ==== 7. Lineup-dependent items needing manual confirmation ====
  if (project.current_snapshot_id && (!lineup || lineup === 'CUSTOM')) {
    // Count items that depend on lineup but couldn't auto-calculate
    const lineupDepResult = await db.prepare(`
      SELECT COUNT(*) as cnt FROM project_cost_items
      WHERE project_id = ? AND snapshot_id = ?
        AND calculation_type IN ('lineup_fixed', 'rule_lookup')
        AND is_selected = 1
        AND (auto_amount = 0 OR auto_amount IS NULL)
    `).bind(projectId, project.current_snapshot_id).first() as any;
    const lineupDepCount = lineupDepResult?.cnt || 0;
    if (lineupDepCount > 0) {
      risks.push({
        id: 'lineup_dependent_manual_items',
        category: 'input',
        severity: 'warning',
        title: `ラインナップ依存の工種: ${lineupDepCount} 件が手動入力待ち`,
        description: lineup === 'CUSTOM'
          ? 'オーダーメイド案件のため、ラインナップ固定・ルール参照の工種は業者見積もり等で手動入力してください'
          : 'ラインナップ未定のため自動計算できない工種があります。ラインナップ確定後に再計算するか、手動で金額を入力してください',
        action_required: true,
        action_label: '手動入力が必要な明細を確認',
        detail: { count: lineupDepCount, lineup_status: lineup || '未定' },
      });
      warningCount++;
    }
  }

  // ==== 8. No Snapshot Warning ====
  if (!project.current_snapshot_id) {
    risks.push({
      id: 'no_snapshot',
      category: 'system',
      severity: 'error',
      title: 'スナップショットが未作成',
      description: 'プロジェクトにはまだコスト計算が実行されていません',
      action_required: true,
      action_label: '初期スナップショットを作成してください',
    });
    errorCount++;
  }

  // ==== Sort risks by severity (error → warning → info) ====
  const severityOrder = { error: 1, warning: 2, info: 3 };
  risks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ==== Overall Risk Score ====
  // Score: error = 10pts, warning = 3pts, info = 1pt
  const riskScore = errorCount * 10 + warningCount * 3 + infoCount;
  let riskLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';
  if (riskScore >= 30) riskLevel = 'critical';
  else if (riskScore >= 15) riskLevel = 'high';
  else if (riskScore >= 5) riskLevel = 'medium';

  return c.json({
    success: true,
    data: {
      project_id: projectId,
      project_status: project.status,
      current_snapshot_id: project.current_snapshot_id,
      revision_no: project.revision_no,

      // Summary
      summary: {
        risk_level: riskLevel,
        risk_score: riskScore,
        error_count: errorCount,
        warning_count: warningCount,
        info_count: infoCount,
        total_risks: risks.length,
        action_required_count: risks.filter(r => r.action_required).length,
      },

      // Input completeness
      input_completion: {
        overall_rate: inputCompletionRate,
        required_rate: requiredCompletionRate,
        filled_fields: filledFields,
        total_fields: totalFields,
        unset_required: unsetRequired,
        unset_recommended: unsetRecommended,
      },

      // Sales gap
      sales_gap: salesGapData,

      // Regeneration diffs
      regeneration_diffs: {
        unresolved: unresolvedDiffs,
        significant: significantDiffs,
        total_change_amount: totalChangeAmount,
      },

      // Review progress
      review_progress: reviewProgress,

      // All risk items
      risks,

      // Warning counts by source
      warning_summary: {
        ai: aiWarnings.length,
        system: generalWarnings.filter(w => w.source === 'system').length,
        regeneration: generalWarnings.filter(w => w.source === 'regeneration').length,
        manual: generalWarnings.filter(w => w.source === 'manual').length,
      },
    },
  });
});

// Helper: get thresholds (same as salesEstimates)
async function getThresholds(db: D1Database) {
  const settings = await db.prepare(`
    SELECT setting_key, setting_value FROM system_settings
    WHERE setting_key IN (
      'sales_gap_warning_threshold', 'sales_gap_error_threshold',
      'default_standard_margin_rate', 'default_solar_margin_rate', 'default_option_margin_rate'
    )
  `).all() as any;

  const result: Record<string, number> = {
    sales_gap_warning_threshold: 10, sales_gap_error_threshold: 20,
    default_standard_margin_rate: 30, default_solar_margin_rate: 25, default_option_margin_rate: 30,
  };

  for (const s of (settings.results || [])) {
    result[s.setting_key] = parseFloat(s.setting_value);
  }
  return result;
}

export default riskCentreRoutes;
