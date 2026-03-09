-- ============================================================
-- Migration 0008: Password Reset Token
-- - Add reset_token and reset_token_expires columns to app_users
-- ============================================================

ALTER TABLE app_users ADD COLUMN reset_token TEXT;
ALTER TABLE app_users ADD COLUMN reset_token_expires TEXT;

-- Index for quick token lookup
CREATE INDEX IF NOT EXISTS idx_app_users_reset_token ON app_users(reset_token);
