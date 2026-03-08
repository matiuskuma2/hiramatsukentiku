-- ============================================================
-- Step 2.5 Migration: warnings source + status columns
-- ============================================================

-- 1. Add source column to project_warnings
--    source: 'system' | 'ai' | 'regeneration' | 'manual'
ALTER TABLE project_warnings ADD COLUMN source TEXT DEFAULT 'system';

-- 2. Add status column to project_warnings
--    status: 'open' | 'resolved' | 'ignored'
--    (is_resolved 0/1 は後方互換で残す)
ALTER TABLE project_warnings ADD COLUMN status TEXT DEFAULT 'open';

-- 3. Sync existing data: is_resolved=1 → status='resolved'
UPDATE project_warnings SET status = 'resolved' WHERE is_resolved = 1;

-- 4. Add index for status-based queries
CREATE INDEX IF NOT EXISTS idx_pw_status ON project_warnings(project_id, status);
