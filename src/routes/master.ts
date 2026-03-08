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
// PATCH /api/master/system-settings/:key  (CR-03 Fix)
// 権限: admin, manager
// --------------------------------------------------
masterRoutes.patch('/system-settings/:key', requireRole('admin', 'manager'), async (c) => {
  const db = c.env.DB;
  const key = c.req.param('key');
  const user = c.get('currentUser')!;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, 400);
  }

  if (!body || body.setting_value === undefined) {
    return c.json({ success: false, error: 'setting_value is required', code: 'VALIDATION_ERROR' }, 400);
  }

  // Verify setting exists
  const existing = await db.prepare(
    'SELECT id, setting_key, setting_value, value_type FROM system_settings WHERE setting_key = ?'
  ).bind(key).first() as any;

  if (!existing) {
    return c.json({ success: false, error: `Setting not found: ${key}`, code: 'NOT_FOUND' }, 404);
  }

  // Type validation
  const newValue = String(body.setting_value);
  if (existing.value_type === 'number' && isNaN(Number(newValue))) {
    return c.json({ success: false, error: `Invalid number value for ${key}`, code: 'VALIDATION_ERROR' }, 400);
  }
  if (existing.value_type === 'boolean' && !['true', 'false'].includes(newValue)) {
    return c.json({ success: false, error: `Invalid boolean value for ${key}`, code: 'VALIDATION_ERROR' }, 400);
  }

  const oldValue = existing.setting_value;

  await db.prepare(
    "UPDATE system_settings SET setting_value = ?, updated_at = datetime('now') WHERE setting_key = ?"
  ).bind(newValue, key).run();

  // Audit log (best effort — skip if CHECK constraint prevents it)
  try {
    await db.prepare(`
      INSERT INTO project_audit_logs (project_id, action, target_type, target_id, before_value, after_value, changed_by, changed_at)
      VALUES (0, 'update', 'project', ?, ?, ?, ?, datetime('now'))
    `).bind('setting:' + key, JSON.stringify({ setting_key: key, old_value: oldValue }), JSON.stringify({ setting_key: key, new_value: newValue }), user.id).run();
  } catch {
    // Audit log write failed due to FK or CHECK constraint — non-critical, skip silently
  }

  const updated = await db.prepare('SELECT * FROM system_settings WHERE setting_key = ?').bind(key).first();

  return c.json({
    success: true,
    data: updated,
    message: `設定「${key}」を更新しました`,
  });
});

// --------------------------------------------------
// POST /api/master/items
// 権限: admin
// Create new master item
// --------------------------------------------------
masterRoutes.post('/items', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON body' }, 400); }

  if (!body.category_code || !body.item_code || !body.item_name) {
    return c.json({ success: false, error: 'category_code, item_code, item_name are required' }, 400);
  }

  // Generate ID
  const itemId = 'item_' + body.item_code;

  // Check duplicate
  const existing = await db.prepare('SELECT id FROM cost_master_items WHERE id = ? OR item_code = ?').bind(itemId, body.item_code).first();
  if (existing) {
    return c.json({ success: false, error: `工種コード '${body.item_code}' は既に存在します` }, 409);
  }

  // Get max display_order
  const maxOrder = await db.prepare(
    'SELECT MAX(display_order) as max_order FROM cost_master_items WHERE category_code = ?'
  ).bind(body.category_code).first() as any;
  const displayOrder = (maxOrder?.max_order || 0) + 10;

  await db.prepare(`
    INSERT INTO cost_master_items (
      id, category_code, item_code, item_name, unit,
      base_unit_price, base_fixed_amount, calculation_type,
      section_type, item_group, vendor_name, note,
      display_order, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `).bind(
    itemId, body.category_code, body.item_code, body.item_name, body.unit || null,
    body.base_unit_price ?? null, body.base_fixed_amount ?? null, body.calculation_type || 'manual_quote',
    body.section_type || 'basic', body.item_group || 'basic', body.vendor_name || null, body.note || null,
    displayOrder
  ).run();

  // Log the change
  try {
    await db.prepare(`
      INSERT INTO master_change_logs (target_table, target_id, change_type, field_name, before_value, after_value, reason, changed_by, changed_at)
      VALUES ('cost_master_items', ?, 'create', 'all', '{}', ?, '管理画面から新規追加', ?, datetime('now'))
    `).bind(itemId, JSON.stringify(body), user.id).run();
  } catch {}

  const created = await db.prepare('SELECT * FROM cost_master_items WHERE id = ?').bind(itemId).first();
  return c.json({ success: true, data: created, message: '新規工種を追加しました' }, 201);
});

// --------------------------------------------------
// PATCH /api/master/items/:id
// 権限: admin
// Update base_unit_price, base_fixed_amount, unit, vendor_name, note
// --------------------------------------------------
masterRoutes.patch('/items/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const id = c.req.param('id');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON body' }, 400); }

  const item = await db.prepare('SELECT * FROM cost_master_items WHERE id = ?').bind(id).first() as any;
  if (!item) return c.json({ success: false, error: `Item not found: ${id}` }, 404);

  const setClauses: string[] = [];
  const values: any[] = [];
  const changes: Record<string, { old: any; new: any }> = {};

  if (body.base_unit_price !== undefined) {
    setClauses.push('base_unit_price = ?'); values.push(body.base_unit_price);
    changes.base_unit_price = { old: item.base_unit_price, new: body.base_unit_price };
  }
  if (body.base_fixed_amount !== undefined) {
    setClauses.push('base_fixed_amount = ?'); values.push(body.base_fixed_amount);
    changes.base_fixed_amount = { old: item.base_fixed_amount, new: body.base_fixed_amount };
  }
  if (body.unit !== undefined) { setClauses.push('unit = ?'); values.push(body.unit || null); }
  if (body.vendor_name !== undefined) { setClauses.push('vendor_name = ?'); values.push(body.vendor_name || null); }
  if (body.note !== undefined) { setClauses.push('note = ?'); values.push(body.note || null); }

  if (setClauses.length === 0) {
    return c.json({ success: false, error: 'No fields to update' }, 400);
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  await db.prepare(`UPDATE cost_master_items SET ${setClauses.join(', ')} WHERE id = ?`).bind(...values).run();

  // Log the change
  if (Object.keys(changes).length > 0) {
    try {
      await db.prepare(`
        INSERT INTO master_change_logs (target_table, target_id, change_type, field_name, before_value, after_value, reason, changed_by, changed_at)
        VALUES ('cost_master_items', ?, 'price_change', ?, ?, ?, '管理画面から変更', ?, datetime('now'))
      `).bind(id, Object.keys(changes).join(','), JSON.stringify(changes), JSON.stringify(body), user.id).run();
    } catch {}
  }

  const updated = await db.prepare('SELECT * FROM cost_master_items WHERE id = ?').bind(id).first();
  return c.json({ success: true, data: updated, message: '単価を更新しました' });
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
