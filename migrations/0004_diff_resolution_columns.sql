-- ==============================================
-- Migration 0004: Diff Resolution columns
-- Step 3.2: diff 解決のための resolution_status, resolution_note, resolved_by, resolved_at を追加
-- ==============================================

-- resolution_status: pending / adopted / kept / dismissed / manual_adjusted
ALTER TABLE project_cost_regeneration_diffs ADD COLUMN resolution_status TEXT DEFAULT 'pending';

-- resolution_note: 担当者のメモ
ALTER TABLE project_cost_regeneration_diffs ADD COLUMN resolution_note TEXT;

-- resolved_by: app_users.id
ALTER TABLE project_cost_regeneration_diffs ADD COLUMN resolved_by INTEGER;

-- resolved_at: timestamp
ALTER TABLE project_cost_regeneration_diffs ADD COLUMN resolved_at TEXT;

-- manual_adjusted_amount: manual_adjust 時の金額
ALTER TABLE project_cost_regeneration_diffs ADD COLUMN manual_adjusted_amount REAL;

-- Index for unresolved diffs
CREATE INDEX IF NOT EXISTS idx_diffs_project_status ON project_cost_regeneration_diffs(project_id, resolution_status);
