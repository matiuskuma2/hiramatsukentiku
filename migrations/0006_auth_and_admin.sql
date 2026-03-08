-- ============================================================
-- Migration 0006: Authentication & Admin Enhancements
-- - Add password_hash to app_users for simple login
-- - Add assigned_to_email for project ownership display
-- ============================================================

-- 1. Add password_hash column for simple email+password auth
ALTER TABLE app_users ADD COLUMN password_hash TEXT;

-- 2. Add name_kana if not exists (already in schema but just in case)
-- skip - already in initial schema

-- 3. Set default admin password (SHA-256 of 'admin123')
-- In production, users will change passwords on first login
-- Hash is bcrypt-like but we use simple SHA-256 for Cloudflare Workers compatibility
UPDATE app_users SET password_hash = 'initial_setup_required' WHERE role = 'admin';

-- 4. Insert demo users for testing
INSERT OR IGNORE INTO app_users (email, name, role, status, password_hash)
VALUES 
  ('manager@hiramatsu.example.com', 'テスト管理者', 'manager', 'active', 'initial_setup_required'),
  ('estimator@hiramatsu.example.com', 'テスト見積担当', 'estimator', 'active', 'initial_setup_required'),
  ('viewer@hiramatsu.example.com', 'テスト閲覧者', 'viewer', 'active', 'initial_setup_required');
