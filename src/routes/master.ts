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
  const lineup = c.req.query('lineup'); // filter by lineup in conditions_json
  const search = c.req.query('search');

  let sql = `
    SELECT r.id, r.master_item_id, r.rule_group, r.rule_name, r.priority,
           r.conditions_json, r.actions_json, r.is_active,
           r.valid_from, r.valid_to, r.created_at,
           m.item_name, m.category_code
    FROM cost_rule_conditions r
    LEFT JOIN cost_master_items m ON r.master_item_id = m.id
    WHERE 1=1
  `;
  const binds: any[] = [];

  if (itemId) {
    sql += ' AND r.master_item_id = ?';
    binds.push(itemId);
  }
  if (ruleGroup) {
    sql += ' AND r.rule_group = ?';
    binds.push(ruleGroup);
  }
  if (lineup) {
    // Filter rules whose conditions_json contains this lineup value
    sql += " AND r.conditions_json LIKE ?";
    binds.push(`%"${lineup}"%`);
  }
  if (search) {
    sql += ' AND (r.rule_name LIKE ? OR r.id LIKE ? OR m.item_name LIKE ?)';
    const term = `%${search}%`;
    binds.push(term, term, term);
  }

  sql += ' ORDER BY m.category_code, r.master_item_id, r.rule_group, r.priority ASC';

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

// ==================================================
// Lineup CRUD
// ==================================================

// --------------------------------------------------
// GET /api/master/lineups
// 権限: all (ログイン済み)
// --------------------------------------------------
masterRoutes.get('/lineups', async (c) => {
  const db = c.env.DB;
  const activeOnly = c.req.query('active_only') !== 'false';
  let sql = 'SELECT code, name, short_name, description, is_custom, sort_order, is_active, created_at, updated_at FROM lineups';
  if (activeOnly) sql += ' WHERE is_active = 1';
  sql += ' ORDER BY sort_order ASC';
  const result = await db.prepare(sql).all();
  return c.json({ success: true, data: result.results, meta: { total: result.results?.length || 0 } } satisfies ApiResponse);
});

// --------------------------------------------------
// POST /api/master/lineups (admin only)
// --------------------------------------------------
masterRoutes.post('/lineups', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON body' }, 400); }
  if (!body.code || !body.name) return c.json({ success: false, error: 'code と name は必須です' }, 400);
  const existing = await db.prepare('SELECT code FROM lineups WHERE code = ?').bind(body.code).first();
  if (existing) return c.json({ success: false, error: `コード '${body.code}' は既に存在します` }, 409);
  const maxOrder = await db.prepare('SELECT MAX(sort_order) as mx FROM lineups WHERE is_custom = 0').first() as any;
  const sortOrder = body.sort_order || (maxOrder?.mx || 0) + 10;
  await db.prepare(`
    INSERT INTO lineups (code, name, short_name, description, is_custom, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `).bind(body.code, body.name, body.short_name || body.name, body.description || null, body.is_custom ? 1 : 0, sortOrder).run();
  const created = await db.prepare('SELECT * FROM lineups WHERE code = ?').bind(body.code).first();
  return c.json({ success: true, data: created, message: 'ラインナップを追加しました' }, 201);
});

// --------------------------------------------------
// PATCH /api/master/lineups/:code (admin only)
// --------------------------------------------------
masterRoutes.patch('/lineups/:code', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const code = c.req.param('code');
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON body' }, 400); }
  const item = await db.prepare('SELECT * FROM lineups WHERE code = ?').bind(code).first();
  if (!item) return c.json({ success: false, error: `ラインナップが見つかりません: ${code}` }, 404);
  const sets: string[] = []; const vals: any[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.short_name !== undefined) { sets.push('short_name = ?'); vals.push(body.short_name); }
  if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description || null); }
  if (body.is_custom !== undefined) { sets.push('is_custom = ?'); vals.push(body.is_custom ? 1 : 0); }
  if (body.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(body.sort_order); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (sets.length === 0) return c.json({ success: false, error: '変更がありません' }, 400);
  sets.push("updated_at = datetime('now')");
  vals.push(code);
  await db.prepare(`UPDATE lineups SET ${sets.join(', ')} WHERE code = ?`).bind(...vals).run();
  const updated = await db.prepare('SELECT * FROM lineups WHERE code = ?').bind(code).first();
  return c.json({ success: true, data: updated, message: 'ラインナップを更新しました' });
});

// ==================================================
// Rule CRUD (cost_rule_conditions)
// ==================================================

// --------------------------------------------------
// GET /api/master/rules (enhanced with item name + filter)
// 権限: all (ログイン済み)
// Query: ?item_id=xxx&rule_group=selection&lineup=SHIN&search=大工
// --------------------------------------------------
// (already defined above at line ~181)

// --------------------------------------------------
// GET /api/master/rules/:id
// 権限: all
// --------------------------------------------------
masterRoutes.get('/rules/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const rule = await db.prepare(`
    SELECT r.*, m.item_name, m.category_code
    FROM cost_rule_conditions r
    LEFT JOIN cost_master_items m ON r.master_item_id = m.id
    WHERE r.id = ?
  `).bind(id).first();
  if (!rule) return c.json({ success: false, error: `Rule not found: ${id}` }, 404);
  return c.json({ success: true, data: rule } satisfies ApiResponse);
});

// --------------------------------------------------
// POST /api/master/rules (admin only)
// --------------------------------------------------
masterRoutes.post('/rules', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON body' }, 400); }

  // Validate required fields
  if (!body.master_item_id) return c.json({ success: false, error: 'master_item_id は必須です' }, 400);
  if (!body.rule_group) return c.json({ success: false, error: 'rule_group は必須です' }, 400);

  const validGroups = ['selection', 'calculation', 'warning', 'cross_category'];
  if (!validGroups.includes(body.rule_group)) return c.json({ success: false, error: `rule_group は ${validGroups.join(', ')} のいずれかです` }, 400);

  // Verify item exists
  const item = await db.prepare('SELECT id FROM cost_master_items WHERE id = ?').bind(body.master_item_id).first();
  if (!item) return c.json({ success: false, error: `工種が見つかりません: ${body.master_item_id}` }, 404);

  // Validate JSON arrays
  let conditionsJson: string;
  let actionsJson: string;
  try {
    const conds = Array.isArray(body.conditions) ? body.conditions : [];
    conditionsJson = JSON.stringify(conds);
  } catch { return c.json({ success: false, error: 'conditions の形式が正しくありません' }, 400); }
  try {
    const acts = Array.isArray(body.actions) ? body.actions : [];
    if (acts.length === 0) return c.json({ success: false, error: 'アクションを1つ以上設定してください' }, 400);
    actionsJson = JSON.stringify(acts);
  } catch { return c.json({ success: false, error: 'actions の形式が正しくありません' }, 400); }

  // Generate rule ID
  const ruleId = body.id || `rule_${body.master_item_id.replace('item_', '')}_${Date.now()}`;

  // Check duplicate
  const existing = await db.prepare('SELECT id FROM cost_rule_conditions WHERE id = ?').bind(ruleId).first();
  if (existing) return c.json({ success: false, error: `ルールID '${ruleId}' は既に存在します` }, 409);

  await db.prepare(`
    INSERT INTO cost_rule_conditions (id, master_item_id, rule_group, rule_name, priority, conditions_json, actions_json, is_active, valid_from, valid_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))
  `).bind(
    ruleId, body.master_item_id, body.rule_group, body.rule_name || ruleId,
    body.priority ?? 100, conditionsJson, actionsJson,
    body.valid_from || null, body.valid_to || null
  ).run();

  // Audit log
  try {
    await db.prepare(`
      INSERT INTO master_change_logs (target_table, target_id, change_type, field_name, before_value, after_value, reason, changed_by, changed_at)
      VALUES ('cost_rule_conditions', ?, 'create', 'all', '{}', ?, '管理画面からルール追加', ?, datetime('now'))
    `).bind(ruleId, JSON.stringify({ conditions: body.conditions, actions: body.actions }), user.id).run();
  } catch {}

  const created = await db.prepare(`
    SELECT r.*, m.item_name, m.category_code
    FROM cost_rule_conditions r LEFT JOIN cost_master_items m ON r.master_item_id = m.id
    WHERE r.id = ?
  `).bind(ruleId).first();
  return c.json({ success: true, data: created, message: 'ルールを追加しました' }, 201);
});

// --------------------------------------------------
// PATCH /api/master/rules/:id (admin only)
// --------------------------------------------------
masterRoutes.patch('/rules/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const id = c.req.param('id');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON body' }, 400); }

  const existing = await db.prepare('SELECT * FROM cost_rule_conditions WHERE id = ?').bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: `ルールが見つかりません: ${id}` }, 404);

  const sets: string[] = [];
  const vals: any[] = [];
  const changes: Record<string, any> = {};

  if (body.rule_group !== undefined) {
    const validGroups = ['selection', 'calculation', 'warning', 'cross_category'];
    if (!validGroups.includes(body.rule_group)) return c.json({ success: false, error: `rule_group は ${validGroups.join(', ')} のいずれかです` }, 400);
    sets.push('rule_group = ?'); vals.push(body.rule_group);
    changes.rule_group = { old: existing.rule_group, new: body.rule_group };
  }
  if (body.rule_name !== undefined) { sets.push('rule_name = ?'); vals.push(body.rule_name); }
  if (body.priority !== undefined) { sets.push('priority = ?'); vals.push(body.priority); changes.priority = { old: existing.priority, new: body.priority }; }
  if (body.conditions !== undefined) {
    const condStr = JSON.stringify(Array.isArray(body.conditions) ? body.conditions : []);
    sets.push('conditions_json = ?'); vals.push(condStr);
    changes.conditions_json = { old: existing.conditions_json, new: condStr };
  }
  if (body.actions !== undefined) {
    const actStr = JSON.stringify(Array.isArray(body.actions) ? body.actions : []);
    sets.push('actions_json = ?'); vals.push(actStr);
    changes.actions_json = { old: existing.actions_json, new: actStr };
  }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); changes.is_active = { old: existing.is_active, new: body.is_active ? 1 : 0 }; }
  if (body.valid_from !== undefined) { sets.push('valid_from = ?'); vals.push(body.valid_from || null); }
  if (body.valid_to !== undefined) { sets.push('valid_to = ?'); vals.push(body.valid_to || null); }

  if (sets.length === 0) return c.json({ success: false, error: '変更がありません' }, 400);

  vals.push(id);
  await db.prepare(`UPDATE cost_rule_conditions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

  // Audit log
  if (Object.keys(changes).length > 0) {
    try {
      await db.prepare(`
        INSERT INTO master_change_logs (target_table, target_id, change_type, field_name, before_value, after_value, reason, changed_by, changed_at)
        VALUES ('cost_rule_conditions', ?, 'update', ?, ?, ?, '管理画面からルール更新', ?, datetime('now'))
      `).bind(id, Object.keys(changes).join(','), JSON.stringify(changes), JSON.stringify(body), user.id).run();
    } catch {}
  }

  const updated = await db.prepare(`
    SELECT r.*, m.item_name, m.category_code
    FROM cost_rule_conditions r LEFT JOIN cost_master_items m ON r.master_item_id = m.id
    WHERE r.id = ?
  `).bind(id).first();
  return c.json({ success: true, data: updated, message: 'ルールを更新しました' });
});

// --------------------------------------------------
// DELETE /api/master/rules/:id (admin only)
// --------------------------------------------------
masterRoutes.delete('/rules/:id', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const id = c.req.param('id');

  const existing = await db.prepare('SELECT * FROM cost_rule_conditions WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ success: false, error: `ルールが見つかりません: ${id}` }, 404);

  await db.prepare('DELETE FROM cost_rule_conditions WHERE id = ?').bind(id).run();

  // Audit log
  try {
    await db.prepare(`
      INSERT INTO master_change_logs (target_table, target_id, change_type, field_name, before_value, after_value, reason, changed_by, changed_at)
      VALUES ('cost_rule_conditions', ?, 'delete', 'all', ?, '{}', '管理画面からルール削除', ?, datetime('now'))
    `).bind(id, JSON.stringify(existing), user.id).run();
  } catch {}

  return c.json({ success: true, message: 'ルールを削除しました' });
});

export default masterRoutes;
