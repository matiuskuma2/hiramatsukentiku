-- ==============================================
-- Migration 0007: ラインナップ管理マスタ化
-- - lineups テーブル新規作成
-- - projects.lineup を nullable + CHECK制約解除
-- ==============================================

-- 1. lineups マスタテーブル
CREATE TABLE IF NOT EXISTS lineups (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  description TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lineups_active ON lineups(is_active, sort_order);

-- 2. 初期データ
INSERT OR IGNORE INTO lineups (code, name, short_name, description, is_custom, sort_order) VALUES
  ('SHIN',        'SHIN',        'SHIN',       '真壁の家 SHIN シリーズ', 0, 10),
  ('RIN',         'RIN',         'RIN',        '真壁の家 RIN シリーズ',  0, 20),
  ('MOKU_OOYANE', 'MOKU 大屋根', 'MOKU大屋根',  'MOKU 大屋根シリーズ',    0, 30),
  ('MOKU_HIRAYA', 'MOKU 平屋',   'MOKU平屋',    'MOKU 平屋シリーズ',      0, 40),
  ('MOKU_ROKU',   'MOKU ROKU',   'MOKU ROKU',  'MOKU ROKU シリーズ',     0, 50),
  ('CUSTOM',      'オーダーメイド', 'オーダー',    'シリーズに当てはめず自由設計で進める案件', 1, 900);

-- 3. projects.lineup を nullable 化 (テーブル再作成方式)
CREATE TABLE IF NOT EXISTS projects_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE NOT NULL,
  project_name TEXT NOT NULL,
  customer_name TEXT,
  customer_name_2 TEXT,
  prefecture TEXT,
  city TEXT,
  address_text TEXT,
  municipality_code TEXT,
  is_shizuoka_prefecture INTEGER DEFAULT 1,
  lineup TEXT,  -- nullable, CHECK制約なし
  insulation_grade TEXT CHECK (insulation_grade IN ('5','6')),
  has_wb INTEGER DEFAULT 1,
  fire_zone_type TEXT DEFAULT 'standard' CHECK (fire_zone_type IN ('standard','semi_fire','fire')),
  tsubo REAL,
  building_area_m2 REAL,
  floor1_area_m2 REAL,
  floor2_area_m2 REAL,
  total_floor_area_m2 REAL,
  exterior_wall_area_m2 REAL,
  roof_shape TEXT CHECK (roof_shape IN ('kirizuma','yosemune','katanagare','flat','other')),
  roof_area_m2 REAL,
  eaves_ceiling_area_m2 REAL,
  gutter_length_m REAL,
  downspout_length_m REAL,
  roof_perimeter_m REAL,
  foundation_perimeter_m REAL,
  is_one_story INTEGER DEFAULT 0,
  is_two_family INTEGER DEFAULT 0,
  has_loft INTEGER DEFAULT 0,
  loft_tsubo REAL DEFAULT 0,
  has_dormer INTEGER DEFAULT 0,
  dormer_tsubo REAL DEFAULT 0,
  flat_roof_floor1_area_m2 REAL DEFAULT 0,
  has_pv INTEGER DEFAULT 0,
  pv_capacity_kw REAL,
  pv_panels INTEGER,
  has_battery INTEGER DEFAULT 0,
  battery_capacity_kwh REAL,
  plumbing_distance_m REAL,
  has_water_intake INTEGER DEFAULT 0,
  has_sewer_intake INTEGER DEFAULT 0,
  has_water_meter INTEGER DEFAULT 1,
  entrance_floor_area_m2 REAL,
  entrance_baseboard_length_m REAL,
  porch_area_m2 REAL,
  porch_riser_length_m REAL,
  interior_wall_area_m2 REAL,
  ceiling_area_m2 REAL,
  has_yakisugi INTEGER DEFAULT 0,
  yakisugi_area_m2 REAL,
  is_cleaning_area_standard INTEGER DEFAULT 1,
  standard_gross_margin_rate REAL DEFAULT 30.0,
  solar_gross_margin_rate REAL DEFAULT 25.0,
  option_gross_margin_rate REAL DEFAULT 30.0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','calculating','in_progress','needs_review','reviewed','archived')),
  assigned_to INTEGER,
  reviewer_id INTEGER,
  current_snapshot_id INTEGER,
  revision_no INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 4. データ移行
INSERT INTO projects_new SELECT * FROM projects;

-- 5. 旧テーブル削除 → リネーム
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

-- 6. インデックス再作成
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_lineup ON projects(lineup);
CREATE INDEX IF NOT EXISTS idx_projects_assigned ON projects(assigned_to);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code ON projects(project_code);
