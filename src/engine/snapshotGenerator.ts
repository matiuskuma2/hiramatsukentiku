// ==============================================
// Snapshot Generator Engine
// DB テーブル実カラムに完全対応
//
// project_cost_snapshots: id, project_id, job_id, snapshot_no, status,
//   total_cost, total_standard_cost, total_solar_cost, total_option_cost,
//   estimated_sale_price, overall_margin_rate, items_count, categories_count,
//   confirmed_count, warning_count, project_conditions_json, note, created_by, created_at
//
// project_cost_items: id, project_id, snapshot_id, category_code, master_item_id,
//   master_item_version_id, product_catalog_id, item_name, unit, calculation_type,
//   is_selected, selection_reason, auto_quantity, auto_unit_price, auto_fixed_amount,
//   auto_amount, manual_quantity, manual_unit_price, manual_amount, override_reason,
//   final_quantity, final_unit_price, final_amount, vendor_name, calculation_basis_note,
//   note, warning_text, review_status, reviewed_by, reviewed_at, evidence_file_key,
//   version, sort_order, created_at, updated_at, override_reason_category
//
// project_cost_summaries: id, project_id, category_code, auto_total_amount,
//   manual_adjustment_amount, final_total_amount, review_status, review_comment,
//   reviewed_by, reviewed_at, version, updated_at
//
// project_warnings: id, project_id, snapshot_id, category_code, master_item_id,
//   warning_type, severity, message, recommendation, detail_json,
//   source ('system'|'ai'|'regeneration'|'manual'),
//   status ('open'|'resolved'|'ignored'), is_resolved,
//   resolved_by, resolved_at, resolved_note, created_at
// ==============================================

export interface SnapshotResult {
  snapshot_id: number;
  items_created: number;
  summaries_created: number;
  warnings_created: number;
  total_amount: number;
  duration_ms: number;
}

export async function generateSnapshot(
  db: D1Database,
  projectId: number,
  jobType: string,
  jobId: number
): Promise<SnapshotResult> {
  const start = Date.now();

  // 1. Fetch project
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // 2. Fetch active master items + current versions
  const masterItems = await db.prepare(`
    SELECT mi.id, mi.category_code, mi.item_code, mi.item_name, mi.unit,
           mi.base_unit_price, mi.base_fixed_amount, mi.calculation_type,
           mi.quantity_reference_field, mi.item_group, mi.section_type,
           mi.default_selected, mi.requires_manual_confirmation,
           mi.vendor_name, mi.note, mi.calculation_basis_note,
           mi.display_order,
           v.id as version_id, v.version_no, v.unit_price as version_unit_price,
           v.fixed_amount as version_fixed_amount,
           v.quantity_reference_field as version_qty_ref,
           v.rule_json as version_rule_json
    FROM cost_master_items mi
    LEFT JOIN cost_master_item_versions v 
      ON v.master_item_id = mi.id AND v.effective_to IS NULL
    WHERE mi.is_active = 1
    ORDER BY mi.category_code, mi.display_order
  `).all() as any;

  // 3. Fetch rules
  const rules = await db.prepare(`
    SELECT id, master_item_id, rule_group, rule_name, priority,
           conditions_json, actions_json, is_active
    FROM cost_rule_conditions WHERE is_active = 1
    ORDER BY priority ASC
  `).all() as any;

  const ruleMap = new Map<string, any[]>();
  for (const rule of (rules.results || [])) {
    const arr = ruleMap.get(rule.master_item_id) || [];
    arr.push(rule);
    ruleMap.set(rule.master_item_id, arr);
  }

  // 4. Evaluate each item
  const costItems: any[] = [];
  const warnings: any[] = [];

  for (const item of (masterItems.results || [])) {
    const itemRules = ruleMap.get(item.id) || [];
    const ev = evaluateItem(project, item, itemRules);

    costItems.push({
      project_id: projectId,
      category_code: item.category_code,
      master_item_id: item.id,
      master_item_version_id: item.version_id || null,
      item_name: item.item_name,
      unit: item.unit,
      calculation_type: item.calculation_type,
      is_selected: ev.is_selected ? 1 : 0,
      selection_reason: ev.selection_reason,
      auto_quantity: ev.quantity,
      auto_unit_price: ev.unit_price,
      auto_fixed_amount: ev.fixed_amount,
      auto_amount: ev.auto_amount,
      final_quantity: ev.quantity,
      final_unit_price: ev.unit_price,
      final_amount: ev.auto_amount,
      vendor_name: item.vendor_name,
      calculation_basis_note: item.calculation_basis_note,
      warning_text: item.note,
      review_status: 'pending',
      sort_order: item.display_order || 0,
      override_reason_category: null,
    });

    for (const w of ev.warnings) {
      warnings.push({
        project_id: projectId,
        warning_type: w.type,
        severity: w.severity,
        category_code: item.category_code,
        master_item_id: item.id,
        message: w.message,
        recommendation: w.recommendation || null,
        detail_json: JSON.stringify(w.detail || {}),
        source: w.source || 'system',
      });
    }
  }

  // 5. Build category summaries
  const categoryTotals = new Map<string, { auto: number; final: number; count: number }>();
  for (const ci of costItems) {
    const t = categoryTotals.get(ci.category_code) || { auto: 0, final: 0, count: 0 };
    t.count++;
    if (ci.is_selected) {
      t.auto += ci.auto_amount || 0;
      t.final += ci.final_amount || 0;
    }
    categoryTotals.set(ci.category_code, t);
  }

  // Fetch category info for margin groups
  const categories = await db.prepare(
    'SELECT category_code, category_name, gross_margin_group FROM cost_categories ORDER BY sort_order'
  ).all() as any;
  const catInfo = new Map<string, { name: string; marginGroup: string }>();
  for (const c of (categories.results || [])) {
    catInfo.set(c.category_code, { name: c.category_name, marginGroup: c.gross_margin_group });
  }

  let totalStandard = 0, totalSolar = 0, totalOption = 0;
  const summaryData: any[] = [];

  for (const [code, totals] of categoryTotals.entries()) {
    const info = catInfo.get(code);
    const mg = info?.marginGroup || 'standard';
    if (mg === 'solar') totalSolar += totals.final;
    else if (mg === 'option') totalOption += totals.final;
    else totalStandard += totals.final;

    summaryData.push({
      project_id: projectId,
      category_code: code,
      auto_total_amount: Math.round(totals.auto),
      final_total_amount: Math.round(totals.final),
      review_status: 'pending',
    });
  }

  const grandTotal = totalStandard + totalSolar + totalOption;
  const snapshotNo = (project.revision_no || 0) + 1;

  // Build project conditions JSON for snapshot
  const conditionsJson = JSON.stringify({
    lineup: project.lineup,
    tsubo: project.tsubo,
    building_area_m2: project.building_area_m2,
    total_floor_area_m2: project.total_floor_area_m2,
    insulation_grade: project.insulation_grade,
    has_wb: project.has_wb,
    fire_zone_type: project.fire_zone_type,
    roof_shape: project.roof_shape,
  });

  // === Batch 1: Insert snapshot ===
  const stmts1: D1PreparedStatement[] = [];

  stmts1.push(db.prepare(`
    INSERT INTO project_cost_snapshots (
      project_id, job_id, snapshot_no, status,
      total_cost, total_standard_cost, total_solar_cost, total_option_cost,
      items_count, categories_count, confirmed_count, warning_count,
      project_conditions_json, created_by, created_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))
  `).bind(
    projectId, jobId, snapshotNo,
    Math.round(grandTotal), Math.round(totalStandard), Math.round(totalSolar), Math.round(totalOption),
    costItems.length, categoryTotals.size, warnings.length,
    conditionsJson, 1 /* created_by = admin for now */
  ));

  // Supersede old snapshot if regenerating
  if (project.current_snapshot_id && jobType !== 'initial') {
    stmts1.push(db.prepare(
      "UPDATE project_cost_snapshots SET status = 'superseded' WHERE id = ? AND project_id = ?"
    ).bind(project.current_snapshot_id, projectId));
  }

  const batch1 = await db.batch(stmts1);
  const snapshotId = batch1[0].meta.last_row_id as number;

  // === Batch 2: Items + summaries + warnings + project update ===
  const stmts2: D1PreparedStatement[] = [];

  for (const ci of costItems) {
    stmts2.push(db.prepare(`
      INSERT INTO project_cost_items (
        project_id, snapshot_id, category_code, master_item_id, master_item_version_id,
        item_name, unit, calculation_type, is_selected, selection_reason,
        auto_quantity, auto_unit_price, auto_fixed_amount, auto_amount,
        final_quantity, final_unit_price, final_amount,
        vendor_name, calculation_basis_note, warning_text,
        review_status, sort_order, override_reason_category,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).bind(
      ci.project_id, snapshotId, ci.category_code, ci.master_item_id, ci.master_item_version_id,
      ci.item_name, ci.unit, ci.calculation_type, ci.is_selected, ci.selection_reason,
      ci.auto_quantity, ci.auto_unit_price, ci.auto_fixed_amount, ci.auto_amount,
      ci.final_quantity, ci.final_unit_price, ci.final_amount,
      ci.vendor_name, ci.calculation_basis_note, ci.warning_text,
      ci.review_status, ci.sort_order, ci.override_reason_category
    ));
  }

  // Note: project_cost_summaries has no snapshot_id column
  for (const s of summaryData) {
    stmts2.push(db.prepare(`
      INSERT INTO project_cost_summaries (
        project_id, category_code, auto_total_amount, final_total_amount,
        review_status, version, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    `).bind(s.project_id, s.category_code, s.auto_total_amount, s.final_total_amount, s.review_status));
  }

  for (const w of warnings) {
    stmts2.push(db.prepare(`
      INSERT INTO project_warnings (
        project_id, snapshot_id, category_code, master_item_id,
        warning_type, severity, message, recommendation, detail_json,
        source, status, is_resolved, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, datetime('now'))
    `).bind(
      w.project_id, snapshotId, w.category_code, w.master_item_id,
      w.warning_type, w.severity, w.message, w.recommendation, w.detail_json,
      w.source || 'system'
    ));
  }

  // Update project: set current_snapshot_id, increment revision_no
  // NOTE: status は 'in_progress' に設定（snapshot生成完了 = 見積作業中）
  // 'calculating' は Queue 非同期処理中のみ使用
  stmts2.push(db.prepare(`
    UPDATE projects 
    SET current_snapshot_id = ?, revision_no = ?, 
        status = 'in_progress', updated_at = datetime('now')
    WHERE id = ?
  `).bind(snapshotId, snapshotNo, projectId));

  // Execute batch 2 (split if > 80)
  if (stmts2.length <= 80) {
    await db.batch(stmts2);
  } else {
    for (let i = 0; i < stmts2.length; i += 80) {
      await db.batch(stmts2.slice(i, i + 80));
    }
  }

  return {
    snapshot_id: snapshotId,
    items_created: costItems.length,
    summaries_created: summaryData.length,
    warnings_created: warnings.length,
    total_amount: Math.round(grandTotal),
    duration_ms: Date.now() - start,
  };
}

// ==============================================
// Item Evaluation Engine
// ==============================================
interface EvaluationResult {
  is_selected: boolean;
  selection_reason: string | null;
  quantity: number | null;
  unit_price: number | null;
  fixed_amount: number | null;
  auto_amount: number;
  warnings: Array<{
    type: string;
    severity: string;
    message: string;
    recommendation?: string;
    detail?: any;
    source?: 'system' | 'ai' | 'regeneration' | 'manual';
  }>;
}

function evaluateItem(project: any, item: any, rules: any[]): EvaluationResult {
  const warnings: EvaluationResult['warnings'] = [];

  let unitPrice = item.version_unit_price ?? item.base_unit_price;
  let fixedAmount = item.version_fixed_amount ?? item.base_fixed_amount;
  let qtyRef = item.version_qty_ref ?? item.quantity_reference_field;
  let isSelected = item.default_selected === 1;
  let selectionReason: string | null = isSelected ? 'default_selected' : null;
  let quantity = resolveQuantity(project, qtyRef, item.calculation_type);

  // Apply rules (selection → calculation → warning)
  const sorted = [...rules].sort((a, b) => {
    const order: Record<string, number> = { selection: 1, calculation: 2, warning: 3, cross_category: 4 };
    return (order[a.rule_group] || 99) - (order[b.rule_group] || 99) || a.priority - b.priority;
  });

  for (const rule of sorted) {
    try {
      const conditions = JSON.parse(rule.conditions_json || '[]');
      const actions = JSON.parse(rule.actions_json || '[]');
      if (!evaluateConditions(conditions, project)) continue;

      for (const action of actions) {
        switch (action.type) {
          case 'select':
            isSelected = true;
            selectionReason = `rule:${rule.id}`;
            break;
          case 'deselect':
            isSelected = false;
            selectionReason = `deselect:${rule.id}`;
            break;
          case 'set_quantity':
            quantity = action.value;
            break;
          case 'set_fixed_amount':
            fixedAmount = action.value;
            break;
          case 'set_unit_price':
            unitPrice = action.value;
            break;
          case 'set_reference_field':
            quantity = resolveQuantity(project, action.field, item.calculation_type);
            break;
          case 'flag_manual_confirmation':
            warnings.push({
              type: 'manual_required', severity: 'warning',
              message: action.message || `${item.item_name}: 手動確認が必要です`,
              recommendation: '手動で金額を入力してください',
              source: 'system',
            });
            break;
          case 'show_warning':
            warnings.push({
              type: 'condition_unmet', severity: action.severity || 'info',
              message: action.message || `${item.item_name}: 注意事項があります`,
              source: 'system',
            });
            break;
          case 'add_amount':
            fixedAmount = (fixedAmount || 0) + (action.value || 0);
            break;
        }
      }
    } catch (e) {
      warnings.push({
        type: 'condition_unmet', severity: 'warning',
        message: `Rule error for ${item.item_name}: ${(e as Error).message}`,
        detail: { rule_id: rule.id },
        source: 'system',
      });
    }
  }

  const autoAmount = calculateAmount(item.calculation_type, quantity, unitPrice, fixedAmount);

  // Lineup-specific warnings for items that depend on lineup
  const lineupVal = project.lineup;
  const isLineupDependent = item.calculation_type === 'lineup_fixed' ||
    rules.some(r => {
      try {
        const conds = JSON.parse(r.conditions_json || '[]');
        return conds.some((c: any) => c.field === 'lineup');
      } catch { return false; }
    });

  if (isLineupDependent && isSelected && (!lineupVal || lineupVal === 'CUSTOM')) {
    const reason = !lineupVal ? 'ラインナップ未定' : 'オーダーメイド案件';
    warnings.push({
      type: 'manual_required', severity: 'warning',
      message: `${item.item_name}: ${reason}のため自動計算できません。手動で金額を入力してください`,
      recommendation: '業者見積もりを取得するか、ラインナップ確定後に再計算してください',
      detail: { lineup: lineupVal, calculation_type: item.calculation_type },
      source: 'system',
    });
  }

  if (item.requires_manual_confirmation && isSelected) {
    warnings.push({
      type: 'manual_required', severity: 'warning',
      message: `${item.item_name}: 手動見積もりが必要 (${item.calculation_type})`,
      recommendation: '業者見積もりを取得してください',
      source: 'system',
    });
  }

  if (isSelected && autoAmount === 0 && item.calculation_type !== 'manual_quote') {
    warnings.push({
      type: 'missing_input', severity: 'warning',
      message: `${item.item_name}: 金額が0円です。入力値を確認してください`,
      detail: { quantity, unit_price: unitPrice, fixed_amount: fixedAmount, qty_ref: qtyRef },
      source: 'system',
    });
  }

  return { is_selected: isSelected, selection_reason: selectionReason, quantity, unit_price: unitPrice, fixed_amount: fixedAmount, auto_amount: Math.round(autoAmount), warnings };
}

function resolveQuantity(project: any, fieldRef: string | null, calcType: string): number | null {
  if (!fieldRef) return null;
  const value = project[fieldRef];
  if (value !== undefined && value !== null) return Number(value);
  return null;
}

function calculateAmount(calcType: string, quantity: number | null, unitPrice: number | null, fixedAmount: number | null): number {
  switch (calcType) {
    case 'fixed_amount': return fixedAmount || 0;
    case 'per_tsubo': case 'per_m2': case 'per_meter': case 'per_piece':
      return (quantity || 0) * (unitPrice || 0);
    case 'range_lookup': case 'lineup_fixed': return fixedAmount || 0;
    case 'rule_lookup': return fixedAmount || (quantity || 0) * (unitPrice || 0);
    case 'manual_quote': return 0;
    case 'product_selection': return (quantity || 1) * (unitPrice || 0);
    case 'package_with_delta': case 'threshold_surcharge': return fixedAmount || 0;
    default: return (quantity || 0) * (unitPrice || 0);
  }
}

function evaluateConditions(conditions: any[], project: any): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const cond of conditions) {
    const fv = project[cond.field];
    const tv = cond.value;
    switch (cond.operator) {
      case '=': if (String(fv) !== String(tv)) return false; break;
      case '!=': if (String(fv) === String(tv)) return false; break;
      case '>': if (Number(fv) <= Number(tv)) return false; break;
      case '>=': if (Number(fv) < Number(tv)) return false; break;
      case '<': if (Number(fv) >= Number(tv)) return false; break;
      case '<=': if (Number(fv) > Number(tv)) return false; break;
      case 'in': if (!Array.isArray(tv) || !tv.includes(String(fv))) return false; break;
      case 'not_in': if (Array.isArray(tv) && tv.includes(String(fv))) return false; break;
      case 'between':
        if (Array.isArray(tv) && tv.length === 2) {
          const n = Number(fv);
          if (n < Number(tv[0]) || n > Number(tv[1])) return false;
        }
        break;
    }
  }
  return true;
}
