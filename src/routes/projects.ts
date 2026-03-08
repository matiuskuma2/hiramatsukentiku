// ==============================================
// Project API Routes
// 条件: project 作成と snapshot enqueue は分離
// Step 2.5-D: API Error Code Policy 適用
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import { ProjectStatus, Lineup } from '../schemas/enums';
import { validationError, notFoundError, conflictError } from '../lib/errors';
import { z } from 'zod';

const projectRoutes = new Hono<AppEnv>();

// All project routes require authentication
projectRoutes.use('*', resolveUser);

// === Zod validation schema for project creation ===
const CreateProjectSchema = z.object({
  project_code: z.string().min(1).max(50),
  project_name: z.string().min(1).max(200),
  customer_name: z.string().optional(),
  lineup: Lineup,
  tsubo: z.number().positive().optional(),
  building_area_m2: z.number().positive().optional(),
  total_floor_area_m2: z.number().positive().optional(),
  prefecture: z.string().optional(),
  city: z.string().optional(),
  insulation_grade: z.enum(['5', '6']).optional(),
  has_wb: z.number().int().min(0).max(1).optional(),
  fire_zone_type: z.enum(['standard', 'semi_fire', 'fire']).optional(),
  roof_shape: z.enum(['kirizuma', 'yosemune', 'katanagare', 'flat', 'other']).optional(),
});

// --------------------------------------------------
// GET /api/projects
// 権限: all (viewer以上)
// Query: ?status=draft&page=1&per_page=20
// --------------------------------------------------
projectRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const status = c.req.query('status');
  const page = parseInt(c.req.query('page') || '1');
  const perPage = Math.min(parseInt(c.req.query('per_page') || '20'), 100);
  const offset = (page - 1) * perPage;

  // Access control: admin/manager see all, estimator/viewer see only own projects
  const isAdmin = user.role === 'admin' || user.role === 'manager';

  let countSql = 'SELECT COUNT(*) as total FROM projects WHERE 1=1';
  let sql = `
    SELECT p.id, p.project_code, p.project_name, p.customer_name,
           p.lineup, p.status, p.tsubo, p.building_area_m2, p.total_floor_area_m2,
           p.current_snapshot_id, p.revision_no, p.assigned_to, 
           p.created_at, p.updated_at,
           u.name as assigned_to_name
    FROM projects p
    LEFT JOIN app_users u ON u.id = p.assigned_to
    WHERE 1=1
  `;
  const binds: any[] = [];

  if (!isAdmin) {
    countSql += ' AND assigned_to = ?';
    sql += ' AND p.assigned_to = ?';
    binds.push(user.id);
  }

  if (status) {
    countSql += ' AND status = ?';
    sql += ' AND p.status = ?';
    binds.push(status);
  }

  sql += ' ORDER BY p.updated_at DESC LIMIT ? OFFSET ?';

  // Count total (need to handle non-admin filter for count too)
  const countBinds = binds.slice(0, isAdmin ? (status ? 1 : 0) : (status ? 2 : 1));
  const countStmt = countBinds.length > 0
    ? db.prepare(countSql).bind(...countBinds)
    : db.prepare(countSql);
  const totalResult = await countStmt.first() as any;

  // Fetch page
  const dataStmt = db.prepare(sql).bind(...binds, perPage, offset);
  const result = await dataStmt.all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: totalResult?.total || 0, page, per_page: perPage },
  } satisfies ApiResponse);
});

// --------------------------------------------------
// GET /api/projects/:id
// 権限: all (viewer以上)
// --------------------------------------------------
projectRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));

  if (isNaN(id)) {
    const err = validationError('Invalid project ID: must be a number');
    return c.json(err.body, err.status);
  }

  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();

  if (!project) {
    const err = notFoundError('Project', id);
    return c.json(err.body, err.status);
  }

  return c.json({
    success: true,
    data: project,
  } satisfies ApiResponse);
});

// --------------------------------------------------
// POST /api/projects
// 権限: admin, manager, estimator
// --------------------------------------------------
projectRoutes.post('/', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const body = await c.req.json();

  // Validate
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Request validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const d = parsed.data;

  // Check unique project_code (409 Conflict)
  const existing = await db.prepare(
    'SELECT id FROM projects WHERE project_code = ?'
  ).bind(d.project_code).first();
  if (existing) {
    const err = conflictError(`Project code already exists: ${d.project_code}`);
    return c.json(err.body, err.status);
  }

  // Insert project
  const result = await db.prepare(`
    INSERT INTO projects (
      project_code, project_name, customer_name, lineup,
      tsubo, building_area_m2, total_floor_area_m2,
      prefecture, city, insulation_grade, has_wb, fire_zone_type, roof_shape,
      status, assigned_to, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))
  `).bind(
    d.project_code, d.project_name, d.customer_name || null, d.lineup,
    d.tsubo || null, d.building_area_m2 || null, d.total_floor_area_m2 || null,
    d.prefecture || null, d.city || null,
    d.insulation_grade || null, d.has_wb ?? 1, d.fire_zone_type || 'standard',
    d.roof_shape || null, user.id
  ).run();

  const newId = result.meta.last_row_id;

  // Audit log
  await db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, after_value, changed_by, changed_at)
    VALUES (?, 'create', 'project', ?, ?, ?, datetime('now'))
  `).bind(newId, String(newId), JSON.stringify(d), user.id).run();

  // Fetch created project
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(newId).first();

  return c.json({
    success: true,
    data: project,
  } satisfies ApiResponse, 201);
});

// --------------------------------------------------
// PATCH /api/projects/:id  (CR-05: Project Edit)
// 権限: admin, manager, estimator
// Supports inline edit of all project fields
// --------------------------------------------------
const UpdateProjectSchema = z.object({
  project_name: z.string().min(1).max(200).optional(),
  customer_name: z.string().max(200).nullable().optional(),
  lineup: Lineup.optional(),
  status: ProjectStatus.optional(),
  tsubo: z.number().positive().nullable().optional(),
  building_area_m2: z.number().positive().nullable().optional(),
  total_floor_area_m2: z.number().positive().nullable().optional(),
  floor1_area_m2: z.number().nonnegative().nullable().optional(),
  floor2_area_m2: z.number().nonnegative().nullable().optional(),
  roof_area_m2: z.number().nonnegative().nullable().optional(),
  exterior_wall_area_m2: z.number().nonnegative().nullable().optional(),
  interior_wall_area_m2: z.number().nonnegative().nullable().optional(),
  ceiling_area_m2: z.number().nonnegative().nullable().optional(),
  foundation_perimeter_m: z.number().nonnegative().nullable().optional(),
  roof_perimeter_m: z.number().nonnegative().nullable().optional(),
  porch_area_m2: z.number().nonnegative().nullable().optional(),
  prefecture: z.string().max(50).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  municipality_code: z.string().max(20).nullable().optional(),
  address_text: z.string().max(500).nullable().optional(),
  insulation_grade: z.enum(['5', '6']).nullable().optional(),
  has_wb: z.number().int().min(0).max(1).nullable().optional(),
  fire_zone_type: z.enum(['standard', 'semi_fire', 'fire']).nullable().optional(),
  roof_shape: z.enum(['kirizuma', 'yosemune', 'katanagare', 'flat', 'other']).nullable().optional(),
  has_pv: z.number().int().min(0).max(1).nullable().optional(),
  pv_capacity_kw: z.number().nonnegative().nullable().optional(),
  pv_panels: z.number().int().nonnegative().nullable().optional(),
  has_battery: z.number().int().min(0).max(1).nullable().optional(),
  battery_capacity_kwh: z.number().nonnegative().nullable().optional(),
  has_dormer: z.number().int().min(0).max(1).nullable().optional(),
  dormer_tsubo: z.number().nonnegative().nullable().optional(),
  has_loft: z.number().int().min(0).max(1).nullable().optional(),
  loft_tsubo: z.number().nonnegative().nullable().optional(),
  is_one_story: z.number().int().min(0).max(1).nullable().optional(),
  is_two_family: z.number().int().min(0).max(1).nullable().optional(),
  is_shizuoka_prefecture: z.number().int().min(0).max(1).nullable().optional(),
  has_yakisugi: z.number().int().min(0).max(1).nullable().optional(),
  yakisugi_area_m2: z.number().nonnegative().nullable().optional(),
  has_water_intake: z.number().int().min(0).max(1).nullable().optional(),
  has_sewer_intake: z.number().int().min(0).max(1).nullable().optional(),
  has_water_meter: z.number().int().min(0).max(1).nullable().optional(),
  plumbing_distance_m: z.number().nonnegative().nullable().optional(),
  gutter_length_m: z.number().nonnegative().nullable().optional(),
  downspout_length_m: z.number().nonnegative().nullable().optional(),
  standard_gross_margin_rate: z.number().min(0).max(100).nullable().optional(),
  solar_gross_margin_rate: z.number().min(0).max(100).nullable().optional(),
  option_gross_margin_rate: z.number().min(0).max(100).nullable().optional(),
}).strict();

projectRoutes.patch('/:id', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const id = parseInt(c.req.param('id'));

  if (isNaN(id)) {
    const err = validationError('Invalid project ID: must be a number');
    return c.json(err.body, err.status);
  }

  // Fetch existing project
  const existing = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first() as any;
  if (!existing) {
    const err = notFoundError('Project', id);
    return c.json(err.body, err.status);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const err = validationError('Invalid JSON body');
    return c.json(err.body, err.status);
  }

  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const updates = parsed.data;
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const err = validationError('No fields to update');
    return c.json(err.body, err.status);
  }

  // Build SET clause dynamically
  const setClauses: string[] = [];
  const values: any[] = [];
  const beforeValues: Record<string, any> = {};

  for (const key of keys) {
    const val = (updates as any)[key];
    setClauses.push(`${key} = ?`);
    values.push(val);
    beforeValues[key] = existing[key];
  }

  setClauses.push("updated_at = datetime('now')");
  setClauses.push("version = version + 1");
  values.push(id);

  const sql = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...values).run();

  // Audit log
  await db.prepare(`
    INSERT INTO project_audit_logs (project_id, action, target_type, target_id, before_value, after_value, changed_by, changed_at)
    VALUES (?, 'update', 'project', ?, ?, ?, ?, datetime('now'))
  `).bind(id, String(id), JSON.stringify(beforeValues), JSON.stringify(updates), user.id).run();

  // Return updated project
  const updated = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();

  return c.json({
    success: true,
    data: updated,
    message: `案件を更新しました (${keys.length} 項目)`,
    updated_fields: keys,
  } satisfies ApiResponse);
});

export default projectRoutes;
