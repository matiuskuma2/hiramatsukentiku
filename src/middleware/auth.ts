// ==============================================
// Auth Middleware
// - Production: CF Access header (CF-Access-Authenticated-User-Email)
// - Development: DEV_USER_EMAIL from .dev.vars
// ==============================================
import { Hono } from 'hono';
import type { AppEnv } from '../types/bindings';

/**
 * Resolve current user from CF Access header or DEV_USER_EMAIL
 * Attaches user info to c.set('currentUser', {...})
 */
export async function resolveUser(c: any, next: () => Promise<void>) {
  const db = c.env.DB;
  const cfEmail = c.req.header('CF-Access-Authenticated-User-Email');
  const devEmail = c.env.DEV_USER_EMAIL;
  const email = cfEmail || devEmail;

  if (!email) {
    return c.json({ success: false, error: 'Unauthorized: no email found' }, 401);
  }

  // Look up user in DB
  const user = await db.prepare(
    "SELECT id, email, name, role, status FROM app_users WHERE email = ? AND status = 'active'"
  ).bind(email).first() as any;

  if (!user) {
    return c.json({ success: false, error: `User not found: ${email}` }, 403);
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
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!allowedRoles.includes(user.role)) {
      return c.json({ 
        success: false, 
        error: `Forbidden: role '${user.role}' not in [${allowedRoles.join(', ')}]` 
      }, 403);
    }
    await next();
  };
}
