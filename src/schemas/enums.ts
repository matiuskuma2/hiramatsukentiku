// ==============================================
// Zod Enum Definitions
// Source: 11_ENUM_STATUS_SPEC.md セクション22
// ==============================================
import { z } from 'zod';

// === 1. projects テーブル ===
export const ProjectStatus = z.enum([
  'draft', 'calculating', 'in_progress', 'needs_review', 'reviewed', 'archived'
]);

export const Lineup = z.string().nullable().optional();
// lineup は lineups マスタテーブルで管理。null=未定, 'CUSTOM'=オーダーメイド, その他=ラインナップコード

export const InsulationGrade = z.enum(['5', '6']);

export const RoofShape = z.enum(['kirizuma', 'yosemune', 'katanagare', 'flat', 'other']);

export const FireZoneType = z.enum(['standard', 'semi_fire', 'fire']);

// === 2. cost_categories テーブル ===
export const GrossMarginGroup = z.enum(['standard', 'solar', 'option']);

// === 3. cost_master_items テーブル ===
export const CalculationType = z.enum([
  'fixed_amount', 'per_tsubo', 'per_m2', 'per_meter', 'per_piece',
  'range_lookup', 'lineup_fixed', 'rule_lookup', 'manual_quote',
  'product_selection', 'package_with_delta', 'threshold_surcharge'
]);

export const ItemGroup = z.enum(['basic', 'extra', 'option']);

export const SectionType = z.enum(['basic', 'extra']);

// === 4. cost_rule_conditions テーブル ===
export const RuleGroup = z.enum(['selection', 'calculation', 'warning', 'cross_category']);

export const ConditionOperator = z.enum(['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in', 'between']);

export const ActionType = z.enum([
  'select', 'deselect', 'set_quantity', 'set_fixed_amount',
  'set_unit_price', 'set_reference_field',
  'flag_manual_confirmation', 'show_warning', 'add_amount'
]);

// === 5. project_cost_items / project_cost_summaries ===
export const ReviewStatus = z.enum(['pending', 'confirmed', 'needs_review', 'flagged']);

// === 7. project_warnings テーブル ===
export const WarningType = z.enum([
  'missing_input', 'condition_unmet', 'threshold_exceeded',
  'area_surcharge', 'manual_required', 'cross_category',
  'sales_estimate_gap', 'master_price_expired', 'version_mismatch'
]);

export const Severity = z.enum(['info', 'warning', 'error']);

// === 7b. project_warnings: source / status (Step 2.5-C) ===
export const WarningSource = z.enum(['system', 'ai', 'regeneration', 'manual']);
export const WarningStatus = z.enum(['open', 'resolved', 'ignored']);

// === 8. master_change_logs テーブル ===
export const ChangeType = z.enum(['create', 'update', 'deactivate', 'price_change', 'rule_change']);

// === 9. project_audit_logs テーブル ===
export const AuditAction = z.enum([
  'create', 'update', 'recalculate', 'review', 'override', 'snapshot', 'regenerate'
]);

export const AuditTargetType = z.enum([
  'project', 'cost_item', 'cost_summary', 'snapshot', 'sales_estimate'
]);

// === 10. app_users テーブル ===
export const UserRole = z.enum(['admin', 'manager', 'estimator', 'viewer']);

export const UserStatus = z.enum(['active', 'inactive', 'suspended']);

// === 11. cost_snapshot_jobs テーブル ===
export const SnapshotJobType = z.enum([
  'initial', 'regenerate_preserve_reviewed', 'regenerate_auto_only', 'regenerate_replace_all'
]);

export const SnapshotJobStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);

// === 12. project_cost_snapshots テーブル ===
export const SnapshotStatus = z.enum(['active', 'superseded', 'archived']);

// === 13. project_cost_regeneration_diffs テーブル ===
export const DiffType = z.enum([
  'amount_changed', 'quantity_changed', 'unit_price_changed',
  'fixed_amount_changed', 'selection_changed', 'item_added', 'item_removed'
]);

export const DiffResolutionStatus = z.enum([
  'pending', 'adopted', 'kept', 'dismissed', 'manual_adjusted'
]);

export const DiffResolutionAction = z.enum([
  'adopt_candidate', 'keep_current', 'dismiss', 'manual_adjust'
]);

// === 14. project_sales_estimates テーブル ===
export const EstimateType = z.enum(['rough', 'internal', 'contract', 'execution']);

// === 15. project_input_sources テーブル ===
export const SourceType = z.enum(['manual', 'spreadsheet', 'ai_extract', 'api_import', 'seed_data']);

// === 16. external_references テーブル ===
export const ReferenceType = z.enum([
  'vendor_quote', 'catalog_price', 'municipal_fee', 'historical_data', 'drawing', 'regulation'
]);

// === 17. system_settings テーブル ===
export const SettingType = z.enum(['threshold', 'default_value', 'feature_flag', 'notification', 'calculation']);

// === 18. lineup_packages テーブル ===
export const PriceType = z.enum(['fixed', 'per_tsubo']);

// === 19. project_phase_estimates テーブル ===
export const PhaseType = z.enum([
  'consultation_rough', 'internal_estimate', 'contract_estimate', 'execution_budget'
]);

// === 24. cost_inclusion_rules テーブル (CR-01) ===
export const InclusionType = z.enum(['always', 'conditional', 'never', 'manual']);

export const TargetSummaryGroup = z.enum(['total', 'standard', 'solar', 'option', 'overhead', 'other']);

// === 25. lineup_option_groups テーブル (CR-01) ===
// Lineup enum は #1 で定義済み

// === 手修正理由カテゴリ (CR-02 / CR-07 / 16_UX_RISK_PREVENTION_DESIGN) ===
// NOTE: DB の CHECK 制約は ALTER TABLE ADD COLUMN では追加不可のため、Zod で enforce
// TODO [最終DDL]: 正式ベースmigration時の整理:
//   - 初回 CREATE TABLE: CHECK 付き (override_reason_category IN (...))
//   - 途中 ALTER TABLE: Zod で補完（現在の方式）
//   See: migrations/0002_cr01_cr02_tables_and_columns.sql
export const OverrideReasonCategory = z.enum([
  'site_condition', 'customer_request', 'regulatory', 'spec_change',
  'price_update', 'correction', 'vendor_quote', 'other'
]);

// === Enum数カウント（検証用） ===
export const ENUM_COUNT = {
  ProjectStatus: ProjectStatus.options.length,        // 6
  Lineup: 6,                                            // managed in lineups table
  InsulationGrade: InsulationGrade.options.length,    // 2
  RoofShape: RoofShape.options.length,                // 5
  FireZoneType: FireZoneType.options.length,          // 3
  GrossMarginGroup: GrossMarginGroup.options.length,  // 3
  CalculationType: CalculationType.options.length,    // 12
  ItemGroup: ItemGroup.options.length,                // 3
  SectionType: SectionType.options.length,            // 2
  RuleGroup: RuleGroup.options.length,                // 4
  ConditionOperator: ConditionOperator.options.length, // 9
  ActionType: ActionType.options.length,              // 9
  ReviewStatus: ReviewStatus.options.length,          // 4
  WarningType: WarningType.options.length,            // 9
  Severity: Severity.options.length,                  // 3
  WarningSource: WarningSource.options.length,          // 4
  WarningStatus: WarningStatus.options.length,          // 3
  ChangeType: ChangeType.options.length,              // 5
  AuditAction: AuditAction.options.length,            // 7
  AuditTargetType: AuditTargetType.options.length,    // 5
  UserRole: UserRole.options.length,                  // 4
  UserStatus: UserStatus.options.length,              // 3
  SnapshotJobType: SnapshotJobType.options.length,    // 4
  SnapshotJobStatus: SnapshotJobStatus.options.length, // 5
  SnapshotStatus: SnapshotStatus.options.length,      // 3
  DiffType: DiffType.options.length,                  // 7
  DiffResolutionStatus: DiffResolutionStatus.options.length, // 5
  DiffResolutionAction: DiffResolutionAction.options.length, // 4
  EstimateType: EstimateType.options.length,          // 4
  SourceType: SourceType.options.length,              // 5
  ReferenceType: ReferenceType.options.length,        // 6
  SettingType: SettingType.options.length,             // 5
  PriceType: PriceType.options.length,                // 2
  PhaseType: PhaseType.options.length,                // 4
  InclusionType: InclusionType.options.length,                  // 4
  TargetSummaryGroup: TargetSummaryGroup.options.length,        // 6
  OverrideReasonCategory: OverrideReasonCategory.options.length, // 8
  _total: 37 // 37 enum definitions
};
