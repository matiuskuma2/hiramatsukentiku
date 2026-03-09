// ==============================================
// Snapshot Regeneration Engine (Step 3)
// Shadow Snapshot方式: 既存snapshotを直接壊さない
// 
// Modes:
//   preserve_reviewed (default) - confirmed 明細は前のまま保持
//   auto_only          - auto列だけ再計算, manual override保持
//   replace_all        - 全明細を新規再計算 (manager以上のみ)
//
// 処理フロー:
//   1. 新しいshadow snapshot レコードを作成
//   2. マスタから全58件を再評価
//   3. モードに応じて旧明細とマージ
//   4. diff をproject_cost_regeneration_diffs に保存
//   5. 旧snapshotをsuperseded, 新snapshotをactiveに切替
//   6. project.current_snapshot_id を更新, revision_no++
//   7. project.status → in_progress
// ==============================================

import { generateSnapshot, type SnapshotResult } from './snapshotGenerator';

export type RegenerateMode = 'preserve_reviewed' | 'auto_only' | 'replace_all';

export interface RegenerateResult extends SnapshotResult {
  mode: RegenerateMode;
  old_snapshot_id: number;
  diffs_created: number;
  preserved_count: number;
  recalculated_count: number;
  significant_diffs: number;
}

interface OldItem {
  id: number;
  master_item_id: string;
  category_code: string;
  item_name: string;
  is_selected: number;
  auto_quantity: number | null;
  auto_unit_price: number | null;
  auto_fixed_amount: number | null;
  auto_amount: number | null;
  manual_quantity: number | null;
  manual_unit_price: number | null;
  manual_amount: number | null;
  override_reason: string | null;
  override_reason_category: string | null;
  final_quantity: number | null;
  final_unit_price: number | null;
  final_amount: number | null;
  review_status: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  vendor_name: string | null;
  calculation_basis_note: string | null;
  note: string | null;
  evidence_file_key: string | null;
  version: number;
  sort_order: number;
}

export async function regenerateSnapshot(
  db: D1Database,
  projectId: number,
  mode: RegenerateMode,
  jobId: number,
): Promise<RegenerateResult> {
  const start = Date.now();

  // 1. Fetch project + current snapshot
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (!project.current_snapshot_id) throw new Error(`Project has no current snapshot to regenerate`);

  const oldSnapshotId = project.current_snapshot_id as number;

  // 2. Fetch old cost items (indexed by master_item_id)
  const oldItemsResult = await db.prepare(`
    SELECT id, master_item_id, category_code, item_name, is_selected,
           auto_quantity, auto_unit_price, auto_fixed_amount, auto_amount,
           manual_quantity, manual_unit_price, manual_amount,
           override_reason, override_reason_category,
           final_quantity, final_unit_price, final_amount,
           review_status, reviewed_by, reviewed_at,
           vendor_name, calculation_basis_note, note, evidence_file_key,
           version, sort_order
    FROM project_cost_items
    WHERE project_id = ? AND snapshot_id = ?
  `).bind(projectId, oldSnapshotId).all();

  const oldItemMap = new Map<string, OldItem>();
  for (const item of (oldItemsResult.results || []) as OldItem[]) {
    oldItemMap.set(item.master_item_id, item);
  }

  // 3. Re-evaluate from master (same as initial generation)
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

  // 4. Build new items with merge logic
  const newCostItems: any[] = [];
  const warnings: any[] = [];
  const diffs: any[] = [];
  let preservedCount = 0;
  let recalculatedCount = 0;

  for (const item of (masterItems.results || [])) {
    const itemRules = ruleMap.get(item.id) || [];
    const ev = evaluateItemForRegenerate(project, item, itemRules);
    const old = oldItemMap.get(item.id);

    let costItem: any;
    let isPreserved = false;

    if (mode === 'preserve_reviewed' && old && old.review_status === 'confirmed') {
      // === PRESERVE: keep confirmed item exactly as-is, update auto columns only ===
      isPreserved = true;
      preservedCount++;
      costItem = {
        project_id: projectId,
        category_code: old.category_code,
        master_item_id: item.id,
        master_item_version_id: item.version_id || null,
        item_name: old.item_name,
        unit: item.unit,
        calculation_type: item.calculation_type,
        is_selected: old.is_selected,
        selection_reason: `preserved:confirmed`,
        // Auto columns: re-calculated for reference
        auto_quantity: ev.quantity,
        auto_unit_price: ev.unit_price,
        auto_fixed_amount: ev.fixed_amount,
        auto_amount: ev.auto_amount,
        // Manual & final: preserved from old
        manual_quantity: old.manual_quantity,
        manual_unit_price: old.manual_unit_price,
        manual_amount: old.manual_amount,
        override_reason: old.override_reason,
        override_reason_category: old.override_reason_category,
        final_quantity: old.final_quantity,
        final_unit_price: old.final_unit_price,
        final_amount: old.final_amount,
        vendor_name: old.vendor_name,
        calculation_basis_note: old.calculation_basis_note,
        note: old.note,
        warning_text: item.note,
        review_status: old.review_status, // keeps 'confirmed'
        reviewed_by: old.reviewed_by,
        reviewed_at: old.reviewed_at,
        evidence_file_key: old.evidence_file_key,
        sort_order: item.display_order || 0,
        version: old.version,
      };
    } else if (mode === 'auto_only' && old) {
      // === AUTO_ONLY: re-calc auto, keep manual overrides ===
      recalculatedCount++;
      const hasManual = old.manual_quantity !== null || old.manual_unit_price !== null || old.manual_amount !== null;
      costItem = {
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
        manual_quantity: old.manual_quantity,
        manual_unit_price: old.manual_unit_price,
        manual_amount: old.manual_amount,
        override_reason: old.override_reason,
        override_reason_category: old.override_reason_category,
        // Final: use manual if exists, else auto
        final_quantity: hasManual && old.manual_quantity !== null ? old.manual_quantity : ev.quantity,
        final_unit_price: hasManual && old.manual_unit_price !== null ? old.manual_unit_price : ev.unit_price,
        final_amount: old.manual_amount !== null ? old.manual_amount :
          (hasManual ? calculateFinal(old.manual_quantity ?? ev.quantity, old.manual_unit_price ?? ev.unit_price, ev.fixed_amount, item.calculation_type) : ev.auto_amount),
        vendor_name: old.vendor_name || item.vendor_name,
        calculation_basis_note: item.calculation_basis_note,
        note: old.note,
        warning_text: item.note,
        review_status: old.review_status === 'confirmed' ? 'confirmed' : 'pending',
        reviewed_by: old.review_status === 'confirmed' ? old.reviewed_by : null,
        reviewed_at: old.review_status === 'confirmed' ? old.reviewed_at : null,
        evidence_file_key: old.evidence_file_key,
        sort_order: item.display_order || 0,
        version: old.version,
      };
    } else {
      // === REPLACE_ALL or new item ===
      recalculatedCount++;
      costItem = {
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
        manual_quantity: null,
        manual_unit_price: null,
        manual_amount: null,
        override_reason: null,
        override_reason_category: null,
        final_quantity: ev.quantity,
        final_unit_price: ev.unit_price,
        final_amount: ev.auto_amount,
        vendor_name: item.vendor_name,
        calculation_basis_note: item.calculation_basis_note,
        note: null,
        warning_text: item.note,
        review_status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        evidence_file_key: null,
        sort_order: item.display_order || 0,
        version: 1,
      };
    }

    newCostItems.push(costItem);

    // --- Generate diffs ---
    if (old) {
      const oldFinal = old.final_amount ?? 0;
      const newFinal = costItem.final_amount ?? 0;
      const autoChanged = (old.auto_amount ?? 0) !== (ev.auto_amount ?? 0);

      if (oldFinal !== newFinal) {
        const changeAmount = newFinal - oldFinal;
        const changePct = oldFinal !== 0 ? (changeAmount / Math.abs(oldFinal)) * 100 : (newFinal !== 0 ? 100 : 0);
        diffs.push({
          project_id: projectId,
          category_code: item.category_code,
          master_item_id: item.id,
          item_name: item.item_name,
          diff_type: 'amount_changed',
          old_value: JSON.stringify({ final_amount: oldFinal, auto_amount: old.auto_amount }),
          new_value: JSON.stringify({ final_amount: newFinal, auto_amount: ev.auto_amount }),
          change_amount: Math.round(changeAmount),
          change_percent: Math.round(changePct * 100) / 100,
          is_significant: Math.abs(changePct) >= 10 ? 1 : 0,
        });
      }

      if ((old.is_selected === 1) !== (ev.is_selected)) {
        diffs.push({
          project_id: projectId,
          category_code: item.category_code,
          master_item_id: item.id,
          item_name: item.item_name,
          diff_type: 'selection_changed',
          old_value: String(old.is_selected),
          new_value: String(ev.is_selected ? 1 : 0),
          change_amount: null,
          change_percent: null,
          is_significant: 1,
        });
      }

      if (autoChanged && oldFinal === newFinal && isPreserved) {
        // Auto changed but final preserved → still worth recording
        diffs.push({
          project_id: projectId,
          category_code: item.category_code,
          master_item_id: item.id,
          item_name: item.item_name,
          diff_type: 'amount_changed',
          old_value: JSON.stringify({ auto_amount: old.auto_amount }),
          new_value: JSON.stringify({ auto_amount: ev.auto_amount }),
          change_amount: (ev.auto_amount ?? 0) - (old.auto_amount ?? 0),
          change_percent: 0,
          is_significant: 0,
        });
      }
    } else {
      // New item that didn't exist in old snapshot
      diffs.push({
        project_id: projectId,
        category_code: item.category_code,
        master_item_id: item.id,
        item_name: item.item_name,
        diff_type: 'item_added',
        old_value: null,
        new_value: JSON.stringify({ final_amount: costItem.final_amount, is_selected: costItem.is_selected }),
        change_amount: costItem.final_amount ?? 0,
        change_percent: 100,
        is_significant: 1,
      });
    }

    // --- Warnings ---
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
        source: isPreserved ? 'regeneration' : 'system',
      });
    }
  }

  // Check for removed items (in old but not in new master)
  const newItemIds = new Set((masterItems.results || []).map((i: any) => i.id));
  for (const [masterId, old] of oldItemMap) {
    if (!newItemIds.has(masterId)) {
      diffs.push({
        project_id: projectId,
        category_code: old.category_code,
        master_item_id: masterId,
        item_name: old.item_name,
        diff_type: 'item_removed',
        old_value: JSON.stringify({ final_amount: old.final_amount, is_selected: old.is_selected }),
        new_value: null,
        change_amount: -(old.final_amount ?? 0),
        change_percent: -100,
        is_significant: 1,
      });
    }
  }

  // 5. Build category summaries
  const categoryTotals = new Map<string, { auto: number; final: number; count: number }>();
  for (const ci of newCostItems) {
    const t = categoryTotals.get(ci.category_code) || { auto: 0, final: 0, count: 0 };
    t.count++;
    if (ci.is_selected) {
      t.auto += ci.auto_amount || 0;
      t.final += ci.final_amount || 0;
    }
    categoryTotals.set(ci.category_code, t);
  }

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

  const conditionsJson = JSON.stringify({
    lineup: project.lineup, tsubo: project.tsubo,
    building_area_m2: project.building_area_m2,
    total_floor_area_m2: project.total_floor_area_m2,
    insulation_grade: project.insulation_grade,
    has_wb: project.has_wb, fire_zone_type: project.fire_zone_type,
    roof_shape: project.roof_shape,
  });

  // === BATCH 1: Insert new snapshot + supersede old ===
  const stmts1: D1PreparedStatement[] = [];

  stmts1.push(db.prepare(`
    INSERT INTO project_cost_snapshots (
      project_id, job_id, snapshot_no, status,
      total_cost, total_standard_cost, total_solar_cost, total_option_cost,
      items_count, categories_count, confirmed_count, warning_count,
      project_conditions_json, created_by, created_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).bind(
    projectId, jobId, snapshotNo,
    Math.round(grandTotal), Math.round(totalStandard), Math.round(totalSolar), Math.round(totalOption),
    newCostItems.length, categoryTotals.size, preservedCount, warnings.length,
    conditionsJson
  ));

  // Supersede old snapshot
  stmts1.push(db.prepare(
    "UPDATE project_cost_snapshots SET status = 'superseded' WHERE id = ? AND project_id = ?"
  ).bind(oldSnapshotId, projectId));

  const batch1 = await db.batch(stmts1);
  const newSnapshotId = batch1[0].meta.last_row_id as number;

  // === BATCH 2+: Items + summaries + warnings + diffs + project update ===
  const stmts2: D1PreparedStatement[] = [];

  for (const ci of newCostItems) {
    stmts2.push(db.prepare(`
      INSERT INTO project_cost_items (
        project_id, snapshot_id, category_code, master_item_id, master_item_version_id,
        item_name, unit, calculation_type, is_selected, selection_reason,
        auto_quantity, auto_unit_price, auto_fixed_amount, auto_amount,
        manual_quantity, manual_unit_price, manual_amount,
        override_reason, override_reason_category,
        final_quantity, final_unit_price, final_amount,
        vendor_name, calculation_basis_note, note, warning_text,
        review_status, reviewed_by, reviewed_at, evidence_file_key,
        version, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      ci.project_id, newSnapshotId, ci.category_code, ci.master_item_id, ci.master_item_version_id,
      ci.item_name, ci.unit, ci.calculation_type, ci.is_selected, ci.selection_reason,
      ci.auto_quantity, ci.auto_unit_price, ci.auto_fixed_amount, ci.auto_amount,
      ci.manual_quantity, ci.manual_unit_price, ci.manual_amount,
      ci.override_reason, ci.override_reason_category,
      ci.final_quantity, ci.final_unit_price, ci.final_amount,
      ci.vendor_name, ci.calculation_basis_note, ci.note, ci.warning_text,
      ci.review_status, ci.reviewed_by, ci.reviewed_at, ci.evidence_file_key,
      ci.version, ci.sort_order
    ));
  }

  // Delete old summaries and insert new
  stmts2.push(db.prepare('DELETE FROM project_cost_summaries WHERE project_id = ?').bind(projectId));
  for (const s of summaryData) {
    stmts2.push(db.prepare(`
      INSERT INTO project_cost_summaries (
        project_id, category_code, auto_total_amount, final_total_amount,
        review_status, version, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    `).bind(s.project_id, s.category_code, s.auto_total_amount, s.final_total_amount, s.review_status));
  }

  // Warnings
  for (const w of warnings) {
    stmts2.push(db.prepare(`
      INSERT INTO project_warnings (
        project_id, snapshot_id, category_code, master_item_id,
        warning_type, severity, message, recommendation, detail_json,
        source, status, is_resolved, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, datetime('now'))
    `).bind(
      w.project_id, newSnapshotId, w.category_code, w.master_item_id,
      w.warning_type, w.severity, w.message, w.recommendation, w.detail_json,
      w.source
    ));
  }

  // Diffs
  for (const d of diffs) {
    stmts2.push(db.prepare(`
      INSERT INTO project_cost_regeneration_diffs (
        job_id, project_id, old_snapshot_id, new_snapshot_id,
        category_code, master_item_id, item_name,
        diff_type, old_value, new_value,
        change_amount, change_percent, is_significant, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      jobId, d.project_id, oldSnapshotId, newSnapshotId,
      d.category_code, d.master_item_id, d.item_name,
      d.diff_type, d.old_value, d.new_value,
      d.change_amount, d.change_percent, d.is_significant
    ));
  }

  // Update project
  stmts2.push(db.prepare(`
    UPDATE projects 
    SET current_snapshot_id = ?, revision_no = ?, 
        status = 'in_progress', updated_at = datetime('now')
    WHERE id = ?
  `).bind(newSnapshotId, snapshotNo, projectId));

  // Execute in chunks of 80
  for (let i = 0; i < stmts2.length; i += 80) {
    await db.batch(stmts2.slice(i, i + 80));
  }

  const significantDiffs = diffs.filter(d => d.is_significant).length;

  return {
    snapshot_id: newSnapshotId,
    items_created: newCostItems.length,
    summaries_created: summaryData.length,
    warnings_created: warnings.length,
    total_amount: Math.round(grandTotal),
    duration_ms: Date.now() - start,
    mode,
    old_snapshot_id: oldSnapshotId,
    diffs_created: diffs.length,
    preserved_count: preservedCount,
    recalculated_count: recalculatedCount,
    significant_diffs: significantDiffs,
  };
}

// --- Item evaluation (same logic as snapshotGenerator) ---
interface EvalResult {
  is_selected: boolean;
  selection_reason: string | null;
  quantity: number | null;
  unit_price: number | null;
  fixed_amount: number | null;
  auto_amount: number;
  warnings: Array<{ type: string; severity: string; message: string; recommendation?: string; detail?: any; source?: string }>;
}

function evaluateItemForRegenerate(project: any, item: any, rules: any[]): EvalResult {
  const warnings: EvalResult['warnings'] = [];
  let unitPrice = item.version_unit_price ?? item.base_unit_price;
  let fixedAmount = item.version_fixed_amount ?? item.base_fixed_amount;
  let qtyRef = item.version_qty_ref ?? item.quantity_reference_field;
  let isSelected = item.default_selected === 1;
  let selectionReason: string | null = isSelected ? 'default_selected' : null;
  let quantity = resolveQty(project, qtyRef);

  const sorted = [...rules].sort((a, b) => {
    const order: Record<string, number> = { selection: 1, calculation: 2, warning: 3, cross_category: 4 };
    return (order[a.rule_group] || 99) - (order[b.rule_group] || 99) || a.priority - b.priority;
  });

  for (const rule of sorted) {
    try {
      const conditions = JSON.parse(rule.conditions_json || '[]');
      const actions = JSON.parse(rule.actions_json || '[]');
      if (!evalConditions(conditions, project)) continue;
      for (const action of actions) {
        switch (action.type) {
          case 'select': isSelected = true; selectionReason = `rule:${rule.id}`; break;
          case 'deselect': isSelected = false; selectionReason = `deselect:${rule.id}`; break;
          case 'set_quantity': quantity = action.value; break;
          case 'set_fixed_amount': fixedAmount = action.value; break;
          case 'set_unit_price': unitPrice = action.value; break;
          case 'set_reference_field': quantity = resolveQty(project, action.field); break;
          case 'flag_manual_confirmation':
            warnings.push({ type: 'manual_required', severity: 'warning', message: action.message || `${item.item_name}: 手動確認が必要`, recommendation: '手動で金額を入力してください', source: 'system' });
            break;
          case 'show_warning':
            warnings.push({ type: 'condition_unmet', severity: action.severity || 'info', message: action.message || `${item.item_name}: 注意事項`, source: 'system' });
            break;
          case 'add_amount': fixedAmount = (fixedAmount || 0) + (action.value || 0); break;
        }
      }
    } catch (e) {
      warnings.push({ type: 'condition_unmet', severity: 'warning', message: `Rule error: ${(e as Error).message}`, detail: { rule_id: rule.id }, source: 'system' });
    }
  }

  const autoAmount = calcAmount(item.calculation_type, quantity, unitPrice, fixedAmount);

  // Lineup-specific warnings
  const lineupVal = project.lineup;
  const isLineupDependent = item.calculation_type === 'lineup_fixed' ||
    rules.some(r => {
      try { const conds = JSON.parse(r.conditions_json || '[]'); return conds.some((c: any) => c.field === 'lineup'); } catch { return false; }
    });
  if (isLineupDependent && isSelected && (!lineupVal || lineupVal === 'CUSTOM')) {
    const reason = !lineupVal ? 'ラインナップ未定' : 'オーダーメイド案件';
    warnings.push({ type: 'manual_required', severity: 'warning', message: `${item.item_name}: ${reason}のため自動計算できません`, recommendation: '業者見積もりを取得するか、ラインナップ確定後に再計算してください', detail: { lineup: lineupVal }, source: 'system' });
  }

  if (item.requires_manual_confirmation && isSelected) {
    warnings.push({ type: 'manual_required', severity: 'warning', message: `${item.item_name}: 手動見積もりが必要 (${item.calculation_type})`, recommendation: '業者見積もりを取得してください', source: 'system' });
  }
  if (isSelected && autoAmount === 0 && item.calculation_type !== 'manual_quote') {
    warnings.push({ type: 'missing_input', severity: 'warning', message: `${item.item_name}: 金額が0円です`, detail: { quantity, unit_price: unitPrice, fixed_amount: fixedAmount }, source: 'system' });
  }

  return { is_selected: isSelected, selection_reason: selectionReason, quantity, unit_price: unitPrice, fixed_amount: fixedAmount, auto_amount: Math.round(autoAmount), warnings };
}

function resolveQty(project: any, fieldRef: string | null): number | null {
  if (!fieldRef) return null;
  const v = project[fieldRef];
  return v !== undefined && v !== null ? Number(v) : null;
}

function calcAmount(calcType: string, quantity: number | null, unitPrice: number | null, fixedAmount: number | null): number {
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

function calculateFinal(qty: number | null, price: number | null, fixed: number | null, calcType: string): number {
  return Math.round(calcAmount(calcType, qty, price, fixed));
}

function evalConditions(conditions: any[], project: any): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const cond of conditions) {
    const fv = project[cond.field]; const tv = cond.value;
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
