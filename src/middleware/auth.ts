// ==============================================
// Auth Middleware
// - Production: CF Access header (CF-Access-Authenticated-User-Email)
// - Development: DEV_USER_EMAIL from .dev.vars
// Step 2.5-D: API Error Code Policy 適用
// ==============================================
import type { AppEnv } from '../types/bindings';
import { unauthenticatedError, forbiddenError } from '../lib/errors';

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
    const err = unauthenticatedError('No authentication email found. Provide CF-Access header or DEV_USER_EMAIL.');
    return c.json(err.body, err.status);
  }

  // Look up user in DB
  const user = await db.prepare(
    "SELECT id, email, name, role, status FROM app_users WHERE email = ? AND status = 'active'"
  ).bind(email).first() as any;

  if (!user) {
    const err = forbiddenError(`User not found or inactive: ${email}`);
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
      const err = unauthenticatedError('Authentication required');
      return c.json(err.body, err.status);
    }
    if (!allowedRoles.includes(user.role)) {
      const err = forbiddenError(`Role '${user.role}' is not permitted. Required: [${allowedRoles.join(', ')}]`);
      return c.json(err.body, err.status);
    }
    await next();
  };
}
