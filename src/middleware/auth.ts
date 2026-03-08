// ==============================================
// Auth Middleware
// Priority:
//   1. Cookie session (login-based auth)
//   2. CF Access header (CF-Access-Authenticated-User-Email)
//   3. DEV_USER_EMAIL from .dev.vars
// Step 2.5-D: API Error Code Policy 適用
// ==============================================
import type { AppEnv } from '../types/bindings';
import { unauthenticatedError, forbiddenError } from '../lib/errors';

/**
 * Resolve current user from Cookie / CF Access header / DEV_USER_EMAIL
 * Attaches user info to c.set('currentUser', {...})
 */
export async function resolveUser(c: any, next: () => Promise<void>) {
  const db = c.env.DB;

  // 1. Try cookie-based session
  const cookieHeader = c.req.header('Cookie') || '';
  const sessionMatch = cookieHeader.match(/session=([^;]+)/);
  if (sessionMatch && sessionMatch[1]) {
    try {
      const sessionData = JSON.parse(atob(sessionMatch[1]));
      if (sessionData.user_id) {
        const user = await db.prepare(
          "SELECT id, email, name, role, status FROM app_users WHERE id = ? AND status = 'active'"
        ).bind(sessionData.user_id).first() as any;
        if (user) {
          c.set('currentUser', { id: user.id, email: user.email, role: user.role });
          await next();
          return;
        }
      }
    } catch {
      // Invalid cookie, try other methods
    }
  }

  // 2. CF Access header
  const cfEmail = c.req.header('CF-Access-Authenticated-User-Email');

  // 3. DEV_USER_EMAIL fallback
  const devEmail = c.env.DEV_USER_EMAIL;

  const email = cfEmail || devEmail;

  if (!email) {
    const err = unauthenticatedError('認証が必要です。ログインしてください。');
    return c.json(err.body, err.status);
  }

  // Look up user in DB
  const user = await db.prepare(
    "SELECT id, email, name, role, status FROM app_users WHERE email = ? AND status = 'active'"
  ).bind(email).first() as any;

  if (!user) {
    const err = forbiddenError(`ユーザーが見つかりません: ${email}`);
    return c.json(err.body, err.status);
  }

  c.set('currentUser', {
    id: user.id,
    email: user.email,
    role: user.role,
  });

  await next();
}

/**
 * Role-based access control middleware factory
 */
export function requireRole(...allowedRoles: string[]) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('currentUser');
    if (!user) {
      const err = unauthenticatedError('認証が必要です');
      return c.json(err.body, err.status);
    }
    if (!allowedRoles.includes(user.role)) {
      const err = forbiddenError(`権限が不足しています。必要な権限: [${allowedRoles.join(', ')}]`);
      return c.json(err.body, err.status);
    }
    await next();
  };
}
