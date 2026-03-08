// ==============================================
// Master Reference API Routes (一覧参照のみ)
// 条件: 更新系は含めない — 一覧APIを先行
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';

const masterRoutes = new Hono<AppEnv>();

// All master routes require authentication
masterRoutes.use('*', resolveUser);

// --------------------------------------------------
// GET /api/master/categories
// 権限: all (viewer以上)
// --------------------------------------------------
masterRoutes.get('/categories', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT id, category_code, category_name, sort_order, 
           requires_review, gross_margin_group, description, is_active,
           created_at, updated_at
    FROM cost_categories
    ORDER BY sort_order ASC
  `).all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/categories/:code
// 権限: all (viewer以上)
// --------------------------------------------------
masterRoutes.get('/categories/:code', async (c) => {
  const db = c.env.DB;
  const code = c.req.param('code');
  
  const category = await db.prepare(`
    SELECT id, category_code, category_name, sort_order,
           requires_review, gross_margin_group, description, is_active,
           created_at, updated_at
    FROM cost_categories WHERE category_code = ?
  `).bind(code).first();

  if (!category) {
    return c.json({ success: false, error: `Category not found: ${code}` }, 404);
  }

  // Include items count for this category
  const itemCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM cost_master_items WHERE category_code = ?'
  ).bind(code).first() as any;

  return c.json({
    success: true,
    data: { ...category, item_count: itemCount?.cnt || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/items
// 権限: all (viewer以上)
// Query params: ?category=foundation&active_only=true
// --------------------------------------------------
masterRoutes.get('/items', async (c) => {
  const db = c.env.DB;
  const category = c.req.query('category');
  const activeOnly = c.req.query('active_only') !== 'false'; // default true

  let sql = `
    SELECT id, category_code, item_code, item_name, unit,
           base_unit_price, base_fixed_amount, calculation_type,
           quantity_reference_field, item_group, section_type,
           default_selected, requires_manual_confirmation,
           vendor_name, note, calculation_basis_note,
           display_order, is_active, created_at, updated_at
    FROM cost_master_items
    WHERE 1=1
  `;
  const binds: any[] = [];

  if (category) {
    sql += ' AND category_code = ?';
    binds.push(category);
  }
  if (activeOnly) {
    sql += ' AND is_active = 1';
  }

  sql += ' ORDER BY category_code, display_order, item_code';

  const stmt = binds.length > 0
    ? db.prepare(sql).bind(...binds)
    : db.prepare(sql);

  const result = await stmt.all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/items/:id
// 権限: all (viewer以上)
// --------------------------------------------------
masterRoutes.get('/items/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const item = await db.prepare(`
    SELECT id, category_code, item_code, item_name, unit,
           base_unit_price, base_fixed_amount, calculation_type,
           quantity_reference_field, item_group, section_type,
           default_selected, requires_manual_confirmation,
           ai_check_target, vendor_name, vendor_code, note,
           calculation_basis_note, warning_message,
           valid_from, valid_to, price_source, price_source_date,
           display_order, source_sheet_name, is_active,
           created_at, updated_at
    FROM cost_master_items WHERE id = ?
  `).bind(id).first();

  if (!item) {
    return c.json({ success: false, error: `Item not found: ${id}` }, 404);
  }

  return c.json({
    success: true,
    data: item,
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/items/:id/versions
// 権限: all (viewer以上)
// --------------------------------------------------
masterRoutes.get('/items/:id/versions', async (c) => {
  const db = c.env.DB;
  const masterId = c.req.param('id');

  // Verify item exists
  const item = await db.prepare(
    'SELECT id, item_code FROM cost_master_items WHERE id = ?'
  ).bind(masterId).first();

  if (!item) {
    return c.json({ success: false, error: `Item not found: ${masterId}` }, 404);
  }

  const result = await db.prepare(`
    SELECT id, master_item_id, version_no, unit, calculation_type,
           unit_price, fixed_amount, quantity_reference_field,
           vendor_name, note, calculation_basis_note,
           rule_json, effective_from, effective_to,
           change_reason, changed_by, created_at
    FROM cost_master_item_versions
    WHERE master_item_id = ?
    ORDER BY version_no DESC
  `).bind(masterId).all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/rules
// 権限: all (viewer以上)
// Query params: ?item_id=item_xxx&rule_group=selection
// --------------------------------------------------
masterRoutes.get('/rules', async (c) => {
  const db = c.env.DB;
  const itemId = c.req.query('item_id');
  const ruleGroup = c.req.query('rule_group');

  let sql = `
    SELECT id, master_item_id, rule_group, rule_name, priority,
           conditions_json, actions_json, is_active,
           valid_from, valid_to, created_at
    FROM cost_rule_conditions
    WHERE 1=1
  `;
  const binds: any[] = [];

  if (itemId) {
    sql += ' AND master_item_id = ?';
    binds.push(itemId);
  }
  if (ruleGroup) {
    sql += ' AND rule_group = ?';
    binds.push(ruleGroup);
  }

  sql += ' ORDER BY priority ASC, created_at ASC';

  const stmt = binds.length > 0
    ? db.prepare(sql).bind(...binds)
    : db.prepare(sql);

  const result = await stmt.all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/system-settings
// 権限: admin, manager
// --------------------------------------------------
masterRoutes.get('/system-settings', requireRole('admin', 'manager'), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT id, setting_key, setting_value, value_type, description, updated_at
    FROM system_settings
    ORDER BY setting_key ASC
  `).all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/users
// 権限: admin
// --------------------------------------------------
masterRoutes.get('/users', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT id, email, name, role, status, created_at, updated_at
    FROM app_users
    ORDER BY id ASC
  `).all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/master/users/me
// 権限: all (認証済みユーザー)
// --------------------------------------------------
masterRoutes.get('/users/me', async (c) => {
  const user = c.get('currentUser');
  const db = c.env.DB;

  const fullUser = await db.prepare(`
    SELECT id, email, name, role, status, created_at, updated_at
    FROM app_users WHERE id = ?
  `).bind(user!.id).first();

  return c.json({
    success: true,
    data: fullUser,
  } satisfies ApiResponse);
});

export default masterRoutes;
