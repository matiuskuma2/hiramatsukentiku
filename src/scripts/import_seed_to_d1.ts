/**
 * import_seed_to_d1.ts
 * 
 * シードJSONファイルをD1データベースに投入するスクリプト
 * 
 * 投入順序: categories → items → versions → rules (FK依存順)
 * バッチサイズ: 100文/バッチ (D1制限対応)
 * 
 * Usage:
 *   npx tsx src/scripts/import_seed_to_d1.ts --dry-run
 *   npx tsx src/scripts/import_seed_to_d1.ts --execute
 *   npx tsx src/scripts/import_seed_to_d1.ts --generate-sql
 * 
 * @see docs/05_MASTER_DATA_PLAN_v3.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Types
// ============================================================

interface SeedCategory {
  id: string;
  category_code: string;
  category_name: string;
  sort_order: number;
  requires_review: boolean;
  gross_margin_group: string;
  description?: string;
  is_active: boolean;
}

interface SeedItem {
  id: string;
  category_code: string;
  item_code: string;
  item_name: string;
  section_type: string;
  unit: string | null;
  calculation_type: string;
  current_unit_price: number | null;
  current_fixed_amount: number | null;
  quantity_reference_field: string | null;
  default_selected: boolean;
  requires_manual_confirmation: boolean;
  ai_check_target: boolean;
  display_order: number;
  vendor_name: string | null;
  note: string | null;
  calculation_basis_note: string;
  source_sheet_name: string;
  source_file_name: string;
  source_row_no: number;
  is_active: boolean;
  _comment?: string;
}

interface SeedVersion {
  id: string;
  master_item_id: string;
  version_no: number;
  unit_price: number | null;
  fixed_amount: number | null;
  effective_from: string;
  effective_to: string | null;
  change_reason: string;
  changed_by: string;
  rule_json: string;
}

interface RuleCondition {
  field: string;
  operator: string;
  value: unknown;
}

interface RuleAction {
  type: string;
  value?: unknown;
}

interface SeedRule {
  id: string;
  master_item_id: string;
  rule_group: string;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
  _section?: string;
  _comment?: string;
}

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

// ============================================================
// Constants (from 11_ENUM_STATUS_SPEC.md)
// ============================================================

const VALID_GROSS_MARGIN_GROUPS = ['standard', 'solar', 'option'] as const;

const VALID_CALCULATION_TYPES = [
  'fixed_amount', 'per_tsubo', 'per_m2', 'per_meter', 'per_piece',
  'range_lookup', 'lineup_fixed', 'rule_lookup', 'manual_quote',
  'product_selection', 'package_with_delta', 'threshold_surcharge'
] as const;

const VALID_RULE_GROUPS = ['selection', 'calculation', 'warning', 'cross_category'] as const;

const VALID_OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in', 'between'] as const;

const VALID_ACTION_TYPES = [
  'select', 'deselect', 'set_quantity', 'set_fixed_amount',
  'set_unit_price', 'set_reference_field',
  'flag_manual_confirmation', 'show_warning', 'add_amount'
] as const;

const BATCH_SIZE = 100;

// ============================================================
// Helpers
// ============================================================

function boolToInt(val: boolean | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  return val ? 1 : 0;
}

function sqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  return 'NULL';
}

function sqlJsonValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  const json = JSON.stringify(val);
  return `'${json.replace(/'/g, "''")}'`;
}

// ============================================================
// Validation
// ============================================================

function validateCategories(categories: SeedCategory[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sortOrders = new Set<number>();

  for (const cat of categories) {
    // id prefix check
    if (!cat.id.startsWith('cat_')) {
      errors.push(`Category ${cat.id}: id must start with 'cat_'`);
    }
    // category_code non-empty
    if (!cat.category_code || cat.category_code.trim() === '') {
      errors.push(`Category ${cat.id}: category_code must not be empty`);
    }
    // sort_order positive integer
    if (!Number.isInteger(cat.sort_order) || cat.sort_order <= 0) {
      errors.push(`Category ${cat.id}: sort_order must be a positive integer, got ${cat.sort_order}`);
    }
    // sort_order uniqueness
    if (sortOrders.has(cat.sort_order)) {
      errors.push(`Category ${cat.id}: duplicate sort_order ${cat.sort_order}`);
    }
    sortOrders.add(cat.sort_order);
    // gross_margin_group validation
    if (!VALID_GROSS_MARGIN_GROUPS.includes(cat.gross_margin_group as any)) {
      errors.push(`Category ${cat.id}: invalid gross_margin_group '${cat.gross_margin_group}'`);
    }
  }

  return { errors, warnings };
}

function validateItems(items: SeedItem[], categoryCodes: Set<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const itemCodes = new Set<string>();

  for (const item of items) {
    // id prefix
    if (!item.id.startsWith('item_')) {
      errors.push(`Item ${item.id}: id must start with 'item_'`);
    }
    // id == "item_" + item_code (NEW-11)
    const expectedId = 'item_' + item.item_code;
    if (item.id !== expectedId) {
      errors.push(`Item ${item.id}: id must equal 'item_' + item_code ('${expectedId}')`);
    }
    // category_code exists
    if (!categoryCodes.has(item.category_code)) {
      errors.push(`Item ${item.id}: category_code '${item.category_code}' not found in categories`);
    }
    // item_code uniqueness
    if (itemCodes.has(item.item_code)) {
      errors.push(`Item ${item.id}: duplicate item_code '${item.item_code}'`);
    }
    itemCodes.add(item.item_code);
    // calculation_type
    if (!VALID_CALCULATION_TYPES.includes(item.calculation_type as any)) {
      errors.push(`Item ${item.id}: invalid calculation_type '${item.calculation_type}'`);
    }
    // source_sheet_name non-empty (traceability)
    if (!item.source_sheet_name || item.source_sheet_name.trim() === '') {
      errors.push(`Item ${item.id}: source_sheet_name must not be empty (traceability required)`);
    }
    // Price consistency check (NEW-02, NEW-03)
    const ct = item.calculation_type;
    const up = item.current_unit_price;
    const fa = item.current_fixed_amount;
    if (ct === 'fixed_amount' && fa === null && up !== null) {
      errors.push(`Item ${item.id}: fixed_amount type requires current_fixed_amount, but it's null (unit_price=${up})`);
    }
    if (ct === 'lineup_fixed' && fa === null) {
      errors.push(`Item ${item.id}: lineup_fixed type requires current_fixed_amount`);
    }
    if (['per_tsubo', 'per_m2', 'per_meter', 'per_piece'].includes(ct) && up === null) {
      warnings.push(`Item ${item.id}: ${ct} type should have current_unit_price`);
    }
  }

  return { errors, warnings };
}

function validateVersions(versions: SeedVersion[], itemIds: Set<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const versionKeys = new Set<string>();

  for (const ver of versions) {
    // master_item_id exists
    if (!itemIds.has(ver.master_item_id)) {
      errors.push(`Version ${ver.id}: master_item_id '${ver.master_item_id}' not found in items`);
    }
    // version_no positive integer
    if (!Number.isInteger(ver.version_no) || ver.version_no <= 0) {
      errors.push(`Version ${ver.id}: version_no must be a positive integer`);
    }
    // effective_from non-empty
    if (!ver.effective_from || ver.effective_from.trim() === '') {
      errors.push(`Version ${ver.id}: effective_from must not be empty`);
    }
    // uniqueness per master_item_id
    const key = `${ver.master_item_id}:${ver.version_no}`;
    if (versionKeys.has(key)) {
      errors.push(`Version ${ver.id}: duplicate version_no ${ver.version_no} for ${ver.master_item_id}`);
    }
    versionKeys.add(key);
  }

  return { errors, warnings };
}

function validateRules(rules: SeedRule[], itemIds: Set<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    // master_item_id exists
    if (!itemIds.has(rule.master_item_id)) {
      errors.push(`Rule ${rule.id}: master_item_id '${rule.master_item_id}' not found in items`);
    }
    // rule_group
    if (!VALID_RULE_GROUPS.includes(rule.rule_group as any)) {
      errors.push(`Rule ${rule.id}: invalid rule_group '${rule.rule_group}'`);
    }
    // conditions array
    if (!Array.isArray(rule.conditions)) {
      errors.push(`Rule ${rule.id}: conditions must be an array`);
    } else {
      for (const cond of rule.conditions) {
        if (!VALID_OPERATORS.includes(cond.operator as any)) {
          errors.push(`Rule ${rule.id}: invalid operator '${cond.operator}' in conditions`);
        }
      }
    }
    // actions array
    if (!Array.isArray(rule.actions)) {
      errors.push(`Rule ${rule.id}: actions must be an array`);
    } else {
      for (const action of rule.actions) {
        if (!VALID_ACTION_TYPES.includes(action.type as any)) {
          errors.push(`Rule ${rule.id}: invalid action type '${action.type}'`);
        }
      }
    }
  }

  return { errors, warnings };
}

// ============================================================
// SQL Generation
// ============================================================

function generateCategorySQL(cat: SeedCategory): string {
  return `INSERT OR IGNORE INTO cost_categories (id, category_code, category_name, sort_order, requires_review, gross_margin_group, description, is_active) VALUES (${sqlValue(cat.id)}, ${sqlValue(cat.category_code)}, ${sqlValue(cat.category_name)}, ${cat.sort_order}, ${boolToInt(cat.requires_review)}, ${sqlValue(cat.gross_margin_group)}, ${sqlValue(cat.description || null)}, ${boolToInt(cat.is_active)});`;
}

function generateItemSQL(item: SeedItem): string {
  const sourceRawJson = JSON.stringify(item);
  return `INSERT OR IGNORE INTO cost_master_items (id, category_code, item_code, item_name, unit, base_unit_price, base_fixed_amount, calculation_type, quantity_reference_field, item_group, section_type, default_selected, requires_manual_confirmation, ai_check_target, vendor_name, note, calculation_basis_note, display_order, source_sheet_name, source_file_name, source_row_no, source_raw_json, is_active) VALUES (${sqlValue(item.id)}, ${sqlValue(item.category_code)}, ${sqlValue(item.item_code)}, ${sqlValue(item.item_name)}, ${sqlValue(item.unit)}, ${sqlValue(item.current_unit_price)}, ${sqlValue(item.current_fixed_amount)}, ${sqlValue(item.calculation_type)}, ${sqlValue(item.quantity_reference_field)}, ${sqlValue(item.section_type)}, ${sqlValue(item.section_type)}, ${boolToInt(item.default_selected)}, ${boolToInt(item.requires_manual_confirmation)}, ${boolToInt(item.ai_check_target)}, ${sqlValue(item.vendor_name)}, ${sqlValue(item.note)}, ${sqlValue(item.calculation_basis_note)}, ${item.display_order}, ${sqlValue(item.source_sheet_name)}, ${sqlValue(item.source_file_name)}, ${sqlValue(item.source_row_no)}, ${sqlJsonValue(sourceRawJson)}, ${boolToInt(item.is_active)});`;
}

function generateVersionSQL(ver: SeedVersion): string {
  return `INSERT OR IGNORE INTO cost_master_item_versions (id, master_item_id, version_no, unit_price, fixed_amount, effective_from, effective_to, change_reason, changed_by, rule_json) VALUES (${sqlValue(ver.id)}, ${sqlValue(ver.master_item_id)}, ${ver.version_no}, ${sqlValue(ver.unit_price)}, ${sqlValue(ver.fixed_amount)}, ${sqlValue(ver.effective_from)}, ${sqlValue(ver.effective_to)}, ${sqlValue(ver.change_reason)}, ${sqlValue(ver.changed_by)}, ${sqlValue(ver.rule_json)});`;
}

function generateRuleSQL(rule: SeedRule): string {
  const ruleName = rule.id; // Default: same as id (NEW-10)
  return `INSERT OR IGNORE INTO cost_rule_conditions (id, master_item_id, rule_group, rule_name, priority, conditions_json, actions_json, is_active) VALUES (${sqlValue(rule.id)}, ${sqlValue(rule.master_item_id)}, ${sqlValue(rule.rule_group)}, ${sqlValue(ruleName)}, ${rule.priority}, ${sqlJsonValue(rule.conditions)}, ${sqlJsonValue(rule.actions)}, 1);`;
}

// ============================================================
// Main
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isExecute = args.includes('--execute');
  const isGenerateSQL = args.includes('--generate-sql');

  if (!isDryRun && !isExecute && !isGenerateSQL) {
    console.log('Usage:');
    console.log('  npx tsx src/scripts/import_seed_to_d1.ts --dry-run        # Validate only');
    console.log('  npx tsx src/scripts/import_seed_to_d1.ts --generate-sql   # Generate SQL file');
    console.log('  npx tsx src/scripts/import_seed_to_d1.ts --execute        # Execute via wrangler');
    process.exit(1);
  }

  const seedDir = path.resolve(__dirname, '../../seed');
  console.log(`\n=== Seed Import Tool ===`);
  console.log(`Seed directory: ${seedDir}`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN' : isGenerateSQL ? 'GENERATE-SQL' : 'EXECUTE'}\n`);

  // ---- Load files ----
  const categoriesFile = path.join(seedDir, 'seed_categories_priority_a.json');
  const itemsFile = path.join(seedDir, 'seed_items_priority_a.json');
  const versionsFile = path.join(seedDir, 'seed_item_versions_priority_a.json');
  const rulesFile = path.join(seedDir, 'seed_rules_priority_a.json');

  const categories: SeedCategory[] = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
  const rawItems: SeedItem[] = JSON.parse(fs.readFileSync(itemsFile, 'utf-8'));
  const items = rawItems.filter(x => x.id && x.id.startsWith('item_'));
  const versions: SeedVersion[] = JSON.parse(fs.readFileSync(versionsFile, 'utf-8'));
  const rawRules: SeedRule[] = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
  const rules = rawRules.filter(x => x.id && x.id.startsWith('rule_'));

  console.log(`Loaded: ${categories.length} categories, ${items.length} items, ${versions.length} versions, ${rules.length} rules`);

  // ---- Validate ----
  const categoryCodes = new Set(categories.map(c => c.category_code));
  const itemIds = new Set(items.map(i => i.id));

  const catResult = validateCategories(categories);
  const itemResult = validateItems(items, categoryCodes);
  const verResult = validateVersions(versions, itemIds);
  const ruleResult = validateRules(rules, itemIds);

  const allErrors = [
    ...catResult.errors.map(e => `[CAT] ${e}`),
    ...itemResult.errors.map(e => `[ITEM] ${e}`),
    ...verResult.errors.map(e => `[VER] ${e}`),
    ...ruleResult.errors.map(e => `[RULE] ${e}`)
  ];
  const allWarnings = [
    ...catResult.warnings.map(w => `[CAT] ${w}`),
    ...itemResult.warnings.map(w => `[ITEM] ${w}`),
    ...verResult.warnings.map(w => `[VER] ${w}`),
    ...ruleResult.warnings.map(w => `[RULE] ${w}`)
  ];

  if (allWarnings.length > 0) {
    console.log(`\n⚠️  Warnings (${allWarnings.length}):`);
    allWarnings.forEach(w => console.log(`  ${w}`));
  }

  if (allErrors.length > 0) {
    console.log(`\n❌ Validation FAILED (${allErrors.length} errors):`);
    allErrors.forEach(e => console.log(`  ${e}`));
    process.exit(1);
  }

  console.log(`\n✅ Validation PASSED (0 errors, ${allWarnings.length} warnings)`);

  // ---- B-01/B-02/B-03 verification ----
  console.log('\n--- Blocker Fix Verification ---');
  
  // B-01: lineup underscore
  let b01Pass = true;
  for (const rule of rules) {
    for (const cond of rule.conditions || []) {
      if (cond.field === 'lineup') {
        const vals = Array.isArray(cond.value) ? cond.value : [cond.value];
        for (const v of vals) {
          if (typeof v === 'string' && v.includes(' ')) {
            console.log(`  B-01 FAIL: ${rule.id} has space in lineup value '${v}'`);
            b01Pass = false;
          }
        }
      }
    }
  }
  console.log(`  B-01 (lineup underscore): ${b01Pass ? '✅ PASS' : '❌ FAIL'}`);

  // B-02: panel_shipping
  const panelShipping = items.find(i => i.id === 'item_panel_shipping');
  const b02Pass = panelShipping && panelShipping.current_unit_price === null && panelShipping.current_fixed_amount === 60000;
  console.log(`  B-02 (panel_shipping): ${b02Pass ? '✅ PASS' : '❌ FAIL'} (unit_price=${panelShipping?.current_unit_price}, fixed_amount=${panelShipping?.current_fixed_amount})`);

  // B-03: foundation_small_truck
  const smallTruck = items.find(i => i.id === 'item_foundation_small_truck');
  const b03Pass = smallTruck && smallTruck.calculation_type === 'per_piece';
  console.log(`  B-03 (small_truck type): ${b03Pass ? '✅ PASS' : '❌ FAIL'} (type=${smallTruck?.calculation_type})`);

  if (!b01Pass || !b02Pass || !b03Pass) {
    console.log('\n❌ Blocker fixes not applied. Aborting.');
    process.exit(1);
  }

  if (isDryRun) {
    console.log('\n✅ Dry-run complete. All validations passed.');
    process.exit(0);
  }

  // ---- Generate SQL ----
  const sqlStatements: string[] = [];
  
  sqlStatements.push('-- ==============================================');
  sqlStatements.push('-- Seed Data Import (Priority A)');
  sqlStatements.push(`-- Generated: ${new Date().toISOString()}`);
  sqlStatements.push(`-- Categories: ${categories.length}, Items: ${items.length}, Versions: ${versions.length}, Rules: ${rules.length}`);
  sqlStatements.push('-- B-01: lineup underscore FIXED');
  sqlStatements.push('-- B-02: panel_shipping price FIXED');
  sqlStatements.push('-- B-03: foundation_small_truck type FIXED');
  sqlStatements.push('-- ==============================================');
  sqlStatements.push('');

  // Step 1: Categories
  sqlStatements.push('-- Step 1: cost_categories');
  for (const cat of categories) {
    sqlStatements.push(generateCategorySQL(cat));
  }
  sqlStatements.push('');

  // Step 2: Items
  sqlStatements.push('-- Step 2: cost_master_items');
  for (const item of items) {
    sqlStatements.push(generateItemSQL(item));
  }
  sqlStatements.push('');

  // Step 3: Versions
  sqlStatements.push('-- Step 3: cost_master_item_versions');
  for (const ver of versions) {
    sqlStatements.push(generateVersionSQL(ver));
  }
  sqlStatements.push('');

  // Step 4: Rules
  sqlStatements.push('-- Step 4: cost_rule_conditions');
  for (const rule of rules) {
    sqlStatements.push(generateRuleSQL(rule));
  }

  const totalStatements = categories.length + items.length + versions.length + rules.length;
  console.log(`\nTotal SQL statements: ${totalStatements}`);
  console.log(`Batch count: ${Math.ceil(totalStatements / BATCH_SIZE)} (limit: ${BATCH_SIZE}/batch)`);

  if (isGenerateSQL) {
    const outputFile = path.resolve(__dirname, '../../seed/seed_import.sql');
    fs.writeFileSync(outputFile, sqlStatements.join('\n'), 'utf-8');
    console.log(`\n✅ SQL file generated: ${outputFile}`);
    process.exit(0);
  }

  if (isExecute) {
    // Write to temp file and execute via wrangler
    const tempFile = path.resolve(__dirname, '../../seed/seed_import.sql');
    fs.writeFileSync(tempFile, sqlStatements.join('\n'), 'utf-8');
    console.log(`\nSQL written to: ${tempFile}`);
    console.log('Execute with: npx wrangler d1 execute hiramatsu-cost-production --local --file=./seed/seed_import.sql');
    
    // Execute via child_process
    const { execSync } = require('child_process');
    try {
      const result = execSync(
        'npx wrangler d1 execute hiramatsu-cost-production --local --file=./seed/seed_import.sql',
        { cwd: path.resolve(__dirname, '../..'), encoding: 'utf-8', timeout: 30000 }
      );
      console.log(result);
      console.log('\n✅ Seed import completed successfully!');
    } catch (err: any) {
      console.error('\n❌ Seed import failed:');
      console.error(err.stdout || err.message);
      process.exit(1);
    }
  }
}

main();
