-- ==============================================
-- Migration 0005: AI Phase 1 Production Hardening
-- Step 6: AI warnings persistence + read/resolve flow
-- ==============================================

-- is_read: 既読フラグ (AI warnings flow)
ALTER TABLE project_warnings ADD COLUMN is_read INTEGER DEFAULT 0;

-- Index for unread open warnings
CREATE INDEX IF NOT EXISTS idx_warnings_unread ON project_warnings(project_id, status, is_read);
