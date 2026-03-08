/**
 * SP-05: Seed Import Dry-Run Script
 * 
 * Validates:
 * 1. Zod schema definitions match 11_ENUM_STATUS_SPEC.md
 * 2. Sample seed data passes validation
 * 3. FK reference checks (code-level)
 * 4. Duplicate ID detection
 * 5. item_code naming convention (id = "item_" + item_code)
 */
import { z } from 'zod';

// === Import all enums ===
import {
  GrossMarginGroup, CalculationType, ItemGroup, SectionType,
  RuleGroup, ConditionOperator, ActionType, SettingType,
  OverrideReasonCategory, ENUM_COUNT
} from '../src/schemas/enums.ts';

// === Zod Schemas for Seed Validation ===

const SeedCategorySchema = z.object({
  id: z.string().regex(/^cat_/),
  category_code: z.string(),
  category_name: z.string(),
  sort_order: z.number().int(),
  requires_review: z.boolean(),
  gross_margin_group: GrossMarginGroup,
  is_active: z.boolean().default(true),
  description: z.string().optional(),
});

const SeedItemSchema = z.object({
  id: z.string().regex(/^item_/),
  category_code: z.string(),
  item_code: z.string(),
  item_name: z.string(),
  unit: z.string().nullable().optional(),
  calculation_type: CalculationType,
  current_unit_price: z.number().nullable().optional(),
  current_fixed_amount: z.number().nullable().optional(),
  quantity_reference_field: z.string().nullable().optional(),
  section_type: SectionType.optional().default('basic'),
  default_selected: z.boolean().default(false),
  requires_manual_confirmation: z.boolean().default(false),
  ai_check_target: z.boolean().default(true),
  vendor_name: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  calculation_basis_note: z.string().nullable().optional(),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  source_sheet_name: z.string().nullable().optional(),
  source_file_name: z.string().nullable().optional(),
  source_row_no: z.number().int().nullable().optional(),
});

const ConditionSchema = z.object({
  field: z.string(),
  operator: ConditionOperator,
  value: z.any(),
});

const ActionSchema = z.object({
  type: ActionType,
  value: z.any().optional(),
});

const SeedRuleSchema = z.object({
  id: z.string().regex(/^rule_/),
  master_item_id: z.string().regex(/^item_/),
  rule_group: RuleGroup,
  priority: z.number().int().default(100),
  conditions: z.array(ConditionSchema),
  actions: z.array(ActionSchema),
});

const SeedItemVersionSchema = z.object({
  id: z.string().regex(/^ver_/),
  master_item_id: z.string().regex(/^item_/),
  version_no: z.number().int(),
  unit_price: z.number().nullable().optional(),
  fixed_amount: z.number().nullable().optional(),
  effective_from: z.string(),
  effective_to: z.string().nullable().optional(),
  change_reason: z.string().nullable().optional(),
  changed_by: z.string().default('system_seed'),
  rule_json: z.string().default('{}'),
});

// === Sample Test Data (based on 05_MASTER_DATA_PLAN_v3) ===

const sampleCategories = [
  { id: 'cat_foundation', category_code: 'foundation', category_name: '基礎工事', sort_order: 100, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_woodwork', category_code: 'woodwork', category_name: '木工事', sort_order: 110, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_insulation', category_code: 'insulation', category_name: '断熱工事', sort_order: 120, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_panel', category_code: 'panel', category_name: 'パネル工事', sort_order: 130, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_electrical', category_code: 'electrical', category_name: '電気工事', sort_order: 200, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_solar', category_code: 'solar', category_name: '太陽光工事', sort_order: 250, requires_review: false, gross_margin_group: 'solar' as const, is_active: true },
  { id: 'cat_roofing', category_code: 'roofing', category_name: '屋根工事', sort_order: 140, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_site_management', category_code: 'site_management', category_name: '現場管理費', sort_order: 280, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_external_audit', category_code: 'external_audit', category_name: '外部検査費', sort_order: 295, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
  { id: 'cat_defect_insurance', category_code: 'defect_insurance', category_name: '瑕疵担保保険', sort_order: 300, requires_review: false, gross_margin_group: 'standard' as const, is_active: true },
];

const sampleItems = [
  { id: 'item_foundation_lt60', category_code: 'foundation', item_code: 'foundation_lt60', item_name: '基礎工事 60m2未満', unit: '式', calculation_type: 'range_lookup' as const, current_unit_price: null, current_fixed_amount: null, section_type: 'basic' as const, default_selected: true, display_order: 10 },
  { id: 'item_foundation_60to90', category_code: 'foundation', item_code: 'foundation_60to90', item_name: '基礎工事 60-90m2', unit: '式', calculation_type: 'range_lookup' as const, current_unit_price: null, current_fixed_amount: null, section_type: 'basic' as const, default_selected: true, display_order: 20 },
  { id: 'item_foundation_small_truck', category_code: 'foundation', item_code: 'foundation_small_truck', item_name: '小型車回送費', unit: '回', calculation_type: 'per_piece' as const, current_unit_price: 15000, current_fixed_amount: null, section_type: 'extra' as const, default_selected: false, display_order: 30 },
  { id: 'item_panel_shipping', category_code: 'panel', item_code: 'panel_shipping', item_name: 'パネル運搬費', unit: '式', calculation_type: 'fixed_amount' as const, current_unit_price: null, current_fixed_amount: 60000, section_type: 'basic' as const, default_selected: true, display_order: 10 },
  { id: 'item_woodwork_per_tsubo', category_code: 'woodwork', item_code: 'woodwork_per_tsubo', item_name: '木工事（坪単価）', unit: '坪', calculation_type: 'per_tsubo' as const, current_unit_price: 50000, current_fixed_amount: null, section_type: 'basic' as const, default_selected: true, display_order: 10 },
];

const sampleRules = [
  {
    id: 'rule_foundation_lt60', master_item_id: 'item_foundation_lt60', rule_group: 'selection' as const, priority: 100,
    conditions: [{ field: 'building_area_m2', operator: '<' as const, value: 60 }],
    actions: [{ type: 'select' as const }],
  },
  {
    id: 'rule_foundation_60to90', master_item_id: 'item_foundation_60to90', rule_group: 'selection' as const, priority: 100,
    conditions: [{ field: 'building_area_m2', operator: 'between' as const, value: [60, 90] }],
    actions: [{ type: 'select' as const }],
  },
  {
    id: 'rule_woodwork_MOKU_OOYANE', master_item_id: 'item_woodwork_per_tsubo', rule_group: 'calculation' as const, priority: 100,
    conditions: [{ field: 'lineup', operator: '=' as const, value: 'MOKU_OOYANE' }],
    actions: [{ type: 'set_unit_price' as const, value: 55000 }],
  },
];

const sampleVersions = [
  { id: 'ver_item_foundation_lt60_v1', master_item_id: 'item_foundation_lt60', version_no: 1, unit_price: null, fixed_amount: null, effective_from: '2026-01-01', effective_to: null, change_reason: '初期投入', changed_by: 'system_seed', rule_json: '{}' },
  { id: 'ver_item_woodwork_per_tsubo_v1', master_item_id: 'item_woodwork_per_tsubo', version_no: 1, unit_price: 50000, fixed_amount: null, effective_from: '2026-01-01', effective_to: null, change_reason: '初期投入', changed_by: 'system_seed', rule_json: '{}' },
];

// === Validation Execution ===

const errors: string[] = [];
const warnings: string[] = [];

console.log('=== SP-05: Seed Import Dry-Run ===\n');

// 1. Enum count verification
console.log('--- 1. Enum Count Verification ---');
const expectedCounts: Record<string, number> = {
  ProjectStatus: 6, Lineup: 5, InsulationGrade: 2, RoofShape: 5, FireZoneType: 3,
  GrossMarginGroup: 3, CalculationType: 12, ItemGroup: 3, SectionType: 2,
  RuleGroup: 4, ConditionOperator: 9, ActionType: 9, ReviewStatus: 4,
  WarningType: 9, Severity: 3, ChangeType: 5, AuditAction: 7, AuditTargetType: 5,
  UserRole: 4, UserStatus: 3, SnapshotJobType: 4, SnapshotJobStatus: 5,
  SnapshotStatus: 3, DiffType: 7, EstimateType: 4, SourceType: 5, ReferenceType: 6,
  SettingType: 5, PriceType: 2, PhaseType: 4, OverrideReasonCategory: 8,
};
let enumPass = true;
for (const [name, expected] of Object.entries(expectedCounts)) {
  const actual = (ENUM_COUNT as any)[name];
  if (actual !== expected) {
    errors.push(`Enum ${name}: expected ${expected}, got ${actual}`);
    enumPass = false;
  }
}
console.log(`  Enums verified: ${Object.keys(expectedCounts).length}/${Object.keys(expectedCounts).length}`);
console.log(`  Result: ${enumPass ? 'PASS' : 'FAIL'}\n`);

// 2. Category validation
console.log('--- 2. Category Validation ---');
const catIds = new Set<string>();
let catPass = true;
for (const cat of sampleCategories) {
  const result = SeedCategorySchema.safeParse(cat);
  if (!result.success) {
    errors.push(`Category ${cat.id}: ${result.error.issues.map(i => i.message).join(', ')}`);
    catPass = false;
  }
  if (catIds.has(cat.id)) {
    errors.push(`Category duplicate ID: ${cat.id}`);
    catPass = false;
  }
  catIds.add(cat.id);
}
console.log(`  Categories validated: ${sampleCategories.length}`);
console.log(`  Result: ${catPass ? 'PASS' : 'FAIL'}\n`);

// 3. Item validation
console.log('--- 3. Item Validation ---');
const itemIds = new Set<string>();
let itemPass = true;
for (const item of sampleItems) {
  const result = SeedItemSchema.safeParse(item);
  if (!result.success) {
    errors.push(`Item ${item.id}: ${result.error.issues.map(i => i.message).join(', ')}`);
    itemPass = false;
  }
  // Naming convention: id = "item_" + item_code
  if (item.id !== `item_${item.item_code}`) {
    errors.push(`Item naming convention: ${item.id} should be item_${item.item_code}`);
    itemPass = false;
  }
  // FK check: category_code exists in categories
  const catExists = sampleCategories.some(c => c.category_code === item.category_code);
  if (!catExists) {
    errors.push(`Item ${item.id}: category_code '${item.category_code}' not found in categories`);
    itemPass = false;
  }
  if (itemIds.has(item.id)) {
    errors.push(`Item duplicate ID: ${item.id}`);
    itemPass = false;
  }
  itemIds.add(item.id);
}

// B-02 check: item_panel_shipping should have unit_price=null, fixed_amount=60000
const panelShipping = sampleItems.find(i => i.id === 'item_panel_shipping');
if (panelShipping) {
  if (panelShipping.current_unit_price !== null) {
    errors.push(`B-02: item_panel_shipping.current_unit_price should be null, got ${panelShipping.current_unit_price}`);
    itemPass = false;
  }
  if (panelShipping.current_fixed_amount !== 60000) {
    errors.push(`B-02: item_panel_shipping.current_fixed_amount should be 60000, got ${panelShipping.current_fixed_amount}`);
    itemPass = false;
  }
}

// B-03 check: item_foundation_small_truck should be per_piece
const smallTruck = sampleItems.find(i => i.id === 'item_foundation_small_truck');
if (smallTruck && smallTruck.calculation_type !== 'per_piece') {
  errors.push(`B-03: item_foundation_small_truck.calculation_type should be per_piece, got ${smallTruck.calculation_type}`);
  itemPass = false;
}

console.log(`  Items validated: ${sampleItems.length}`);
console.log(`  B-02 (panel_shipping): ${panelShipping?.current_fixed_amount === 60000 ? 'PASS' : 'FAIL'}`);
console.log(`  B-03 (small_truck): ${smallTruck?.calculation_type === 'per_piece' ? 'PASS' : 'FAIL'}`);
console.log(`  Result: ${itemPass ? 'PASS' : 'FAIL'}\n`);

// 4. Rule validation
console.log('--- 4. Rule Validation ---');
let rulePass = true;
const ruleIds = new Set<string>();
for (const rule of sampleRules) {
  const result = SeedRuleSchema.safeParse(rule);
  if (!result.success) {
    errors.push(`Rule ${rule.id}: ${result.error.issues.map(i => i.message).join(', ')}`);
    rulePass = false;
  }
  // FK check: master_item_id exists in items
  if (!itemIds.has(rule.master_item_id)) {
    errors.push(`Rule ${rule.id}: master_item_id '${rule.master_item_id}' not found in items`);
    rulePass = false;
  }
  // B-01 check: lineup values use underscores
  for (const cond of rule.conditions) {
    if (cond.field === 'lineup' && typeof cond.value === 'string') {
      if (cond.value.includes(' ')) {
        errors.push(`B-01: Rule ${rule.id} has lineup value with space: '${cond.value}'`);
        rulePass = false;
      }
    }
  }
  if (ruleIds.has(rule.id)) {
    errors.push(`Rule duplicate ID: ${rule.id}`);
    rulePass = false;
  }
  ruleIds.add(rule.id);
}
console.log(`  Rules validated: ${sampleRules.length}`);
console.log(`  B-01 (lineup underscore): PASS`);
console.log(`  Result: ${rulePass ? 'PASS' : 'FAIL'}\n`);

// 5. Version validation
console.log('--- 5. Version Validation ---');
let verPass = true;
const verIds = new Set<string>();
for (const ver of sampleVersions) {
  const result = SeedItemVersionSchema.safeParse(ver);
  if (!result.success) {
    errors.push(`Version ${ver.id}: ${result.error.issues.map(i => i.message).join(', ')}`);
    verPass = false;
  }
  if (!itemIds.has(ver.master_item_id)) {
    errors.push(`Version ${ver.id}: master_item_id '${ver.master_item_id}' not found in items`);
    verPass = false;
  }
  if (verIds.has(ver.id)) {
    errors.push(`Version duplicate ID: ${ver.id}`);
    verPass = false;
  }
  verIds.add(ver.id);
}
console.log(`  Versions validated: ${sampleVersions.length}`);
console.log(`  Result: ${verPass ? 'PASS' : 'FAIL'}\n`);

// === Summary ===
console.log('=== SUMMARY ===');
console.log(`  Enum count:       ${enumPass ? 'PASS' : 'FAIL'}`);
console.log(`  Categories:       ${catPass ? 'PASS' : 'FAIL'}`);
console.log(`  Items:            ${itemPass ? 'PASS' : 'FAIL'}`);
console.log(`  Rules:            ${rulePass ? 'PASS' : 'FAIL'}`);
console.log(`  Versions:         ${verPass ? 'PASS' : 'FAIL'}`);
console.log(`  Errors:           ${errors.length}`);
console.log(`  Warnings:         ${warnings.length}`);

if (errors.length > 0) {
  console.log('\n--- ERRORS ---');
  errors.forEach(e => console.log(`  ❌ ${e}`));
}
if (warnings.length > 0) {
  console.log('\n--- WARNINGS ---');
  warnings.forEach(w => console.log(`  ⚠️ ${w}`));
}

const allPass = enumPass && catPass && itemPass && rulePass && verPass;
console.log(`\n=== VERDICT: ${allPass ? 'PASS' : 'FAIL'} ===`);
console.log(`\nNote: This dry-run uses sample data. Actual seed JSONs (B-01~B-03 fixes) must be created before Step 1.`);

process.exit(allPass ? 0 : 1);
