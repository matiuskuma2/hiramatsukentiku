// ==============================================
// Admin API Routes
// - User CRUD (admin only)
// - Login / Session management (cookie-based)
// - Password management
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import { validationError, notFoundError, forbiddenError } from '../lib/errors';
import { z } from 'zod';

const adminRoutes = new Hono<AppEnv>();

// ==========================================================
// Helper: Simple password hash using Web Crypto (SHA-256)
// Cloudflare Workers don't support bcrypt, so we use 
// PBKDF2-like approach: SHA-256(salt + password)
// ==========================================================
async function hashPassword(password: string, salt?: string): Promise<string> {
  const s = salt || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const encoder = new TextEncoder();
  const data = encoder.encode(s + ':' + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return s + ':' + hashHex;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || stored === 'initial_setup_required') {
    // First login: any password is accepted and will be set
    return true;
  }
  const [salt] = stored.split(':');
  if (!salt) return false;
  const computed = await hashPassword(password, salt);
  return computed === stored;
}

// ==========================================================
// POST /api/auth/login
// Public endpoint - no auth middleware
// Body: { email, password }
// Returns: { user, token } + sets cookie
// ==========================================================
adminRoutes.post('/auth/login', async (c) => {
  const db = c.env.DB;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return c.json({ success: false, error: 'メールアドレスとパスワードを入力してください' }, 400);
  }

  const user = await db.prepare(
    "SELECT id, email, name, role, status, password_hash FROM app_users WHERE email = ?"
  ).bind(email).first() as any;

  if (!user) {
    return c.json({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' }, 401);
  }

  if (user.status !== 'active') {
    return c.json({ success: false, error: 'アカウントが無効です。管理者にお問い合わせください' }, 403);
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return c.json({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' }, 401);
  }

  // If first login (initial_setup_required), set the password
  if (!user.password_hash || user.password_hash === 'initial_setup_required') {
    const newHash = await hashPassword(password);
    await db.prepare(
      "UPDATE app_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(newHash, user.id).run();
  }

  // Update last_login_at
  await db.prepare(
    "UPDATE app_users SET last_login_at = datetime('now') WHERE id = ?"
  ).bind(user.id).run();

  // Generate simple session token (UUID)
  const sessionToken = crypto.randomUUID();

  // Store session in KV-like approach using system_settings (simple approach)
  // For production, use Cloudflare KV or D1 sessions table
  // For now, we encode user info in the token and verify with DB
  const sessionData = JSON.stringify({
    user_id: user.id,
    email: user.email,
    role: user.role,
    created_at: new Date().toISOString(),
  });

  // Store session token -> user mapping (we'll use a simple approach)
  // Set cookie with session token
  const cookieValue = `session=${btoa(sessionData)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    message: 'ログインしました',
  }, 200, {
    'Set-Cookie': cookieValue,
  });
});

// ==========================================================
// POST /api/auth/logout
// ==========================================================
adminRoutes.post('/auth/logout', async (c) => {
  return c.json({ success: true, message: 'ログアウトしました' }, 200, {
    'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
  });
});

// ==========================================================
// GET /api/auth/me
// Returns current user from cookie or CF-Access header
// ==========================================================
adminRoutes.get('/auth/me', async (c) => {
  const db = c.env.DB;

  // Try cookie-based session first
  const cookieHeader = c.req.header('Cookie') || '';
  const sessionMatch = cookieHeader.match(/session=([^;]+)/);
  if (sessionMatch) {
    try {
      const sessionData = JSON.parse(atob(sessionMatch[1]));
      const user = await db.prepare(
        "SELECT id, email, name, role, status, last_login_at FROM app_users WHERE id = ? AND status = 'active'"
      ).bind(sessionData.user_id).first();
      if (user) {
        return c.json({ success: true, data: user, auth_source: 'cookie' });
      }
    } catch {
      // Invalid cookie, continue to other methods
    }
  }

  // Try CF-Access header
  const cfEmail = c.req.header('CF-Access-Authenticated-User-Email');
  if (cfEmail) {
    const user = await db.prepare(
      "SELECT id, email, name, role, status, last_login_at FROM app_users WHERE email = ? AND status = 'active'"
    ).bind(cfEmail).first();
    if (user) {
      return c.json({ success: true, data: user, auth_source: 'cf-access' });
    }
  }

  // Try DEV_USER_EMAIL
  const devEmail = c.env.DEV_USER_EMAIL;
  if (devEmail) {
    const user = await db.prepare(
      "SELECT id, email, name, role, status, last_login_at FROM app_users WHERE email = ? AND status = 'active'"
    ).bind(devEmail).first();
    if (user) {
      return c.json({ success: true, data: user, auth_source: 'dev-bypass' });
    }
  }

  return c.json({ success: false, error: 'Not authenticated' }, 401);
});

// ==========================================================
// POST /api/auth/change-password
// Authenticated users can change their own password
// ==========================================================
adminRoutes.post('/auth/change-password', resolveUser, async (c) => {
  const db = c.env.DB;
  const currentUser = c.get('currentUser')!;

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }

  const { current_password, new_password } = body || {};
  if (!new_password || new_password.length < 4) {
    return c.json({ success: false, error: 'パスワードは4文字以上で入力してください' }, 400);
  }

  // Fetch current hash
  const user = await db.prepare(
    'SELECT password_hash FROM app_users WHERE id = ?'
  ).bind(currentUser.id).first() as any;

  if (current_password) {
    const valid = await verifyPassword(current_password, user?.password_hash);
    if (!valid) {
      return c.json({ success: false, error: '現在のパスワードが正しくありません' }, 400);
    }
  }

  const newHash = await hashPassword(new_password);
  await db.prepare(
    "UPDATE app_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newHash, currentUser.id).run();

  return c.json({ success: true, message: 'パスワードを変更しました' });
});


// ==========================================================
// Helper: Send email via SendGrid
// ==========================================================
async function sendEmail(apiKey: string, fromEmail: string, to: string, subject: string, html: string): Promise<boolean> {
  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: '平松建築 原価管理システム' },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    return resp.status >= 200 && resp.status < 300;
  } catch (e) {
    console.error('SendGrid error:', e);
    return false;
  }
}

// ==========================================================
// POST /api/auth/reset-request
// Public endpoint - send password reset email
// Body: { email }
// ==========================================================
adminRoutes.post('/auth/reset-request', async (c) => {
  const db = c.env.DB;
  const sendgridKey = c.env.SENDGRID_API_KEY;
  const fromEmail = c.env.SENDGRID_FROM_EMAIL || 'noreply@hiramatsu-cost.pages.dev';

  if (!sendgridKey) {
    return c.json({ success: false, error: 'メール送信が設定されていません。管理者にお問い合わせください。' }, 500);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }

  const { email } = body || {};
  if (!email) {
    return c.json({ success: false, error: 'メールアドレスを入力してください' }, 400);
  }

  // Always return success to prevent email enumeration
  const user = await db.prepare(
    "SELECT id, email, name FROM app_users WHERE email = ? AND status = 'active'"
  ).bind(email).first() as any;

  if (user) {
    // Generate reset token (6-digit code for simplicity)
    const token = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

    await db.prepare(
      "UPDATE app_users SET reset_token = ?, reset_token_expires = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(token, expires, user.id).run();

    // Send email
    const baseUrl = c.req.url.replace(/\/api\/.*$/, '');
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#2d5016;color:white;padding:16px 24px;border-radius:8px 8px 0 0;text-align:center">
          <h2 style="margin:0;font-size:18px">平松建築 原価管理システム</h2>
        </div>
        <div style="background:#f9f9f9;padding:24px;border:1px solid #e5e5e5;border-top:0;border-radius:0 0 8px 8px">
          <p style="margin:0 0 16px">${user.name || ''} 様</p>
          <p style="margin:0 0 16px">パスワードリセットのリクエストを受け付けました。</p>
          <p style="margin:0 0 8px">以下のコードをリセット画面で入力してください:</p>
          <div style="background:white;border:2px solid #2d5016;border-radius:8px;padding:16px;text-align:center;margin:16px 0">
            <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2d5016">${token}</span>
          </div>
          <p style="margin:16px 0 0;font-size:13px;color:#666">
            このコードは30分間有効です。<br>
            心当たりがない場合はこのメールを無視してください。
          </p>
        </div>
      </div>
    `;

    await sendEmail(sendgridKey, fromEmail, email, 'パスワードリセット - 平松建築 原価管理', html);
  }

  // Always return success (prevent email enumeration)
  return c.json({ success: true, message: '登録されたメールアドレスにリセットコードを送信しました' });
});

// ==========================================================
// POST /api/auth/reset-confirm
// Public endpoint - verify token and set new password
// Body: { email, token, new_password }
// ==========================================================
adminRoutes.post('/auth/reset-confirm', async (c) => {
  const db = c.env.DB;

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }

  const { email, token, new_password } = body || {};
  if (!email || !token || !new_password) {
    return c.json({ success: false, error: 'メールアドレス、リセットコード、新しいパスワードを入力してください' }, 400);
  }

  if (new_password.length < 4) {
    return c.json({ success: false, error: 'パスワードは4文字以上で入力してください' }, 400);
  }

  const user = await db.prepare(
    "SELECT id, reset_token, reset_token_expires FROM app_users WHERE email = ? AND status = 'active'"
  ).bind(email).first() as any;

  if (!user || user.reset_token !== token) {
    return c.json({ success: false, error: 'リセットコードが正しくありません' }, 400);
  }

  // Check expiry
  if (user.reset_token_expires && new Date(user.reset_token_expires) < new Date()) {
    return c.json({ success: false, error: 'リセットコードの有効期限が切れています。再度リクエストしてください。' }, 400);
  }

  // Set new password and clear token
  const newHash = await hashPassword(new_password);
  await db.prepare(
    "UPDATE app_users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = datetime('now') WHERE id = ?"
  ).bind(newHash, user.id).run();

  return c.json({ success: true, message: 'パスワードを変更しました。新しいパスワードでログインしてください。' });
});


// ==========================================================
// Admin-only routes below
// ==========================================================

// --------------------------------------------------
// GET /api/admin/users
// List all users
// 権限: admin, manager
// --------------------------------------------------
adminRoutes.get('/admin/users', resolveUser, requireRole('admin', 'manager'), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT id, email, name, name_kana, role, status, department, 
           last_login_at, is_active, created_at, updated_at
    FROM app_users
    ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'estimator' THEN 3 WHEN 'viewer' THEN 4 END, id ASC
  `).all();

  return c.json({
    success: true,
    data: result.results,
    meta: { total: result.results?.length || 0 },
  });
});

// --------------------------------------------------
// POST /api/admin/users
// Create user
// 権限: admin
// --------------------------------------------------
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  name_kana: z.string().max(100).optional(),
  role: z.enum(['admin', 'manager', 'estimator', 'viewer']),
  department: z.string().max(100).optional(),
  password: z.string().min(4).max(100).optional(),
});

adminRoutes.post('/admin/users', resolveUser, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }

  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'バリデーションエラー', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const d = parsed.data;

  // Check duplicate email
  const existing = await db.prepare('SELECT id FROM app_users WHERE email = ?').bind(d.email).first();
  if (existing) {
    return c.json({ success: false, error: 'このメールアドレスは既に登録されています' }, 409);
  }

  // Hash password
  const passwordHash = d.password
    ? await hashPassword(d.password)
    : 'initial_setup_required';

  const result = await db.prepare(`
    INSERT INTO app_users (email, name, name_kana, role, status, department, password_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1, datetime('now'), datetime('now'))
  `).bind(d.email, d.name, d.name_kana || null, d.role, d.department || null, passwordHash).run();

  const newUser = await db.prepare(
    'SELECT id, email, name, name_kana, role, status, department, created_at FROM app_users WHERE id = ?'
  ).bind(result.meta.last_row_id).first();

  return c.json({ success: true, data: newUser, message: 'ユーザーを作成しました' }, 201);
});

// --------------------------------------------------
// PATCH /api/admin/users/:id
// Update user
// 権限: admin
// --------------------------------------------------
const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  name_kana: z.string().max(100).nullable().optional(),
  role: z.enum(['admin', 'manager', 'estimator', 'viewer']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  department: z.string().max(100).nullable().optional(),
  password: z.string().min(4).max(100).optional(),
});

adminRoutes.patch('/admin/users/:id', resolveUser, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));
  if (isNaN(userId)) return c.json({ success: false, error: 'Invalid user ID' }, 400);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }

  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'バリデーションエラー', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const existing = await db.prepare('SELECT id FROM app_users WHERE id = ?').bind(userId).first();
  if (!existing) return c.json({ success: false, error: 'ユーザーが見つかりません' }, 404);

  const d = parsed.data;
  const setClauses: string[] = [];
  const values: any[] = [];

  if (d.name !== undefined) { setClauses.push('name = ?'); values.push(d.name); }
  if (d.name_kana !== undefined) { setClauses.push('name_kana = ?'); values.push(d.name_kana); }
  if (d.role !== undefined) { setClauses.push('role = ?'); values.push(d.role); }
  if (d.status !== undefined) { 
    setClauses.push('status = ?'); values.push(d.status);
    setClauses.push('is_active = ?'); values.push(d.status === 'active' ? 1 : 0);
  }
  if (d.department !== undefined) { setClauses.push('department = ?'); values.push(d.department); }
  if (d.password) {
    const hash = await hashPassword(d.password);
    setClauses.push('password_hash = ?');
    values.push(hash);
  }

  if (setClauses.length === 0) {
    return c.json({ success: false, error: '更新する項目がありません' }, 400);
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(userId);

  await db.prepare(
    `UPDATE app_users SET ${setClauses.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  const updated = await db.prepare(
    'SELECT id, email, name, name_kana, role, status, department, last_login_at, created_at, updated_at FROM app_users WHERE id = ?'
  ).bind(userId).first();

  return c.json({ success: true, data: updated, message: 'ユーザーを更新しました' });
});

// --------------------------------------------------
// DELETE /api/admin/users/:id
// Soft-delete (set status=inactive)
// 権限: admin
// --------------------------------------------------
adminRoutes.delete('/admin/users/:id', resolveUser, requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const currentUser = c.get('currentUser')!;
  const userId = parseInt(c.req.param('id'));
  if (isNaN(userId)) return c.json({ success: false, error: 'Invalid user ID' }, 400);

  // Cannot delete yourself
  if (userId === currentUser.id) {
    return c.json({ success: false, error: '自分自身を削除することはできません' }, 400);
  }

  await db.prepare(
    "UPDATE app_users SET status = 'inactive', is_active = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(userId).run();

  return c.json({ success: true, message: 'ユーザーを無効化しました' });
});

// --------------------------------------------------
// GET /api/admin/stats
// Dashboard statistics for admin
// 権限: admin, manager
// --------------------------------------------------
adminRoutes.get('/admin/stats', resolveUser, requireRole('admin', 'manager'), async (c) => {
  const db = c.env.DB;

  const [userStats, projectStats, recentProjects] = await Promise.all([
    db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
        SUM(CASE WHEN role = 'manager' THEN 1 ELSE 0 END) as managers,
        SUM(CASE WHEN role = 'estimator' THEN 1 ELSE 0 END) as estimators,
        SUM(CASE WHEN role = 'viewer' THEN 1 ELSE 0 END) as viewers
      FROM app_users
    `).first(),
    db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) as needs_review,
        SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed
      FROM projects
    `).first(),
    db.prepare(`
      SELECT id, project_code, project_name, customer_name, status, assigned_to, updated_at
      FROM projects ORDER BY updated_at DESC LIMIT 10
    `).all(),
  ]);

  return c.json({
    success: true,
    data: {
      users: userStats,
      projects: projectStats,
      recent_projects: recentProjects.results,
    },
  });
});

export { hashPassword, verifyPassword };
export default adminRoutes;
