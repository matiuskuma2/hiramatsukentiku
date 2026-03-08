-- ============================================================
-- Migration 0002: CR-01 + CR-02 対応
-- CR-01: テーブル 2 件追加 (cost_inclusion_rules, lineup_option_groups)
-- CR-02: project_cost_items に override_reason_category カラム追加
-- CR-07: override_reason_category の CHECK 制約追加
-- Date: 2026-03-08
-- Step: Step 1-A 初日
-- ============================================================

-- ============================================================
-- 24. cost_inclusion_rules（原価含有ルール）
-- 目的: 原価合計に含めるか否かのルールを管理
-- 用途: 設計本体費・諸経費等の合計金額への含有判定
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_inclusion_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_code TEXT NOT NULL,
  item_code TEXT,
  rule_name TEXT NOT NULL,
  inclusion_type TEXT NOT NULL CHECK (inclusion_type IN ('always','conditional','never','manual')),
  condition_json TEXT,
  target_summary_group TEXT DEFAULT 'total' CHECK (target_summary_group IN ('total','standard','solar','option','overhead','other')),
  priority INTEGER DEFAULT 0,
  description TEXT,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_code) REFERENCES cost_categories(id)
);

CREATE INDEX idx_cir_category ON cost_inclusion_rules(category_code);
CREATE INDEX idx_cir_item ON cost_inclusion_rules(item_code);
CREATE INDEX idx_cir_active ON cost_inclusion_rules(is_active);
CREATE INDEX idx_cir_type ON cost_inclusion_rules(inclusion_type);

-- ============================================================
-- 25. lineup_option_groups（ラインナップオプショングループ）
-- 目的: ラインナップ別のオプション項目グループを管理
-- 用途: SHIN/RIN/MOKU 各ラインナップで選択可能なオプション群
-- ============================================================
CREATE TABLE IF NOT EXISTS lineup_option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lineup TEXT NOT NULL CHECK (lineup IN ('SHIN','RIN','MOKU_OOYANE','MOKU_HIRAYA','MOKU_ROKU')),
  group_name TEXT NOT NULL,
  group_code TEXT UNIQUE NOT NULL,
  category_code TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_default_selected INTEGER DEFAULT 0 CHECK (is_default_selected IN (0, 1)),
  included_item_codes_json TEXT,
  min_selection INTEGER DEFAULT 0,
  max_selection INTEGER,
  description TEXT,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_code) REFERENCES cost_categories(id)
);

CREATE INDEX idx_log_lineup ON lineup_option_groups(lineup);
CREATE INDEX idx_log_category ON lineup_option_groups(category_code);
CREATE INDEX idx_log_group_code ON lineup_option_groups(group_code);
CREATE INDEX idx_log_active ON lineup_option_groups(is_active);
CREATE INDEX idx_log_display ON lineup_option_groups(lineup, display_order);

-- ============================================================
-- CR-02: project_cost_items に override_reason_category カラム追加
-- 手修正理由コード（8種）— 16_UX_RISK_PREVENTION_DESIGN.md 準拠
-- ============================================================
-- NOTE: SQLite ALTER TABLE ADD COLUMN does not support inline CHECK constraints.
-- CHECK constraint will be enforced at application layer (Zod validation).
-- The column is nullable by default.
ALTER TABLE project_cost_items ADD COLUMN override_reason_category TEXT;

-- ============================================================
-- CR-02 補足: admin ユーザー初期投入
-- ============================================================
INSERT OR IGNORE INTO app_users (email, name, role, status)
VALUES ('admin@hiramatsu.example.com', 'System Admin', 'admin', 'active');
