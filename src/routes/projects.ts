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
  const status = c.req.query('status');
  const page = parseInt(c.req.query('page') || '1');
  const perPage = Math.min(parseInt(c.req.query('per_page') || '20'), 100);
  const offset = (page - 1) * perPage;

  let countSql = 'SELECT COUNT(*) as total FROM projects WHERE 1=1';
  let sql = `
    SELECT id, project_code, project_name, customer_name,
           lineup, status, tsubo, building_area_m2, total_floor_area_m2,
           current_snapshot_id, revision_no, assigned_to, 
           created_at, updated_at
    FROM projects WHERE 1=1
  `;
  const binds: any[] = [];

  if (status) {
    countSql += ' AND status = ?';
    sql += ' AND status = ?';
    binds.push(status);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';

  // Count total
  const countStmt = binds.length > 0
    ? db.prepare(countSql).bind(...binds)
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

export default projectRoutes;
