-- ============================================================
-- 平松建築 概算原価管理システム
-- Initial Schema Migration (v4)
-- 25 tables, all CHECK constraints, all indexes
-- ============================================================

-- ============================================================
-- 1. projects（案件マスタ）
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
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
  lineup TEXT NOT NULL CHECK (lineup IN ('SHIN','RIN','MOKU_OOYANE','MOKU_HIRAYA','MOKU_ROKU')),
  insulation_grade TEXT CHECK (insulation_grade IS NULL OR insulation_grade IN ('5','6')),
  has_wb INTEGER DEFAULT 1,
  fire_zone_type TEXT DEFAULT 'standard' CHECK (fire_zone_type IN ('standard','semi_fire','fire')),
  tsubo REAL,
  building_area_m2 REAL,
  floor1_area_m2 REAL,
  floor2_area_m2 REAL,
  total_floor_area_m2 REAL,
  exterior_wall_area_m2 REAL,
  roof_shape TEXT CHECK (roof_shape IS NULL OR roof_shape IN ('kirizuma','yosemune','katanagare','flat','other')),
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

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_lineup ON projects(lineup);
CREATE INDEX idx_projects_customer ON projects(customer_name);
CREATE INDEX idx_projects_created ON projects(created_at);
CREATE INDEX idx_projects_code ON projects(project_code);

-- ============================================================
-- 2. cost_categories（工種マスタ）
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_categories (
  id TEXT PRIMARY KEY,
  category_code TEXT UNIQUE NOT NULL,
  category_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  requires_review INTEGER DEFAULT 0,
  gross_margin_group TEXT DEFAULT 'standard' CHECK (gross_margin_group IN ('standard','solar','option')),
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_cc_sort ON cost_categories(sort_order);
CREATE INDEX idx_cc_active ON cost_categories(is_active);

-- ============================================================
-- 3. cost_master_items（明細マスタ）
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_master_items (
  id TEXT PRIMARY KEY,
  category_code TEXT NOT NULL,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT,
  base_unit_price REAL,
  base_fixed_amount REAL,
  calculation_type TEXT NOT NULL CHECK (calculation_type IN (
    'fixed_amount','per_tsubo','per_m2','per_meter','per_piece',
    'range_lookup','lineup_fixed','rule_lookup','manual_quote',
    'product_selection','package_with_delta','threshold_surcharge'
  )),
  quantity_reference_field TEXT,
  item_group TEXT DEFAULT 'basic' CHECK (item_group IN ('basic','extra','option')),
  section_type TEXT DEFAULT 'basic' CHECK (section_type IN ('basic','extra')),
  default_selected INTEGER DEFAULT 0,
  requires_manual_confirmation INTEGER DEFAULT 0,
  ai_check_target INTEGER DEFAULT 1,
  vendor_name TEXT,
  vendor_code TEXT,
  note TEXT,
  calculation_basis_note TEXT,
  warning_message TEXT,
  valid_from TEXT,
  valid_to TEXT,
  price_source TEXT,
  price_source_date TEXT,
  display_order INTEGER DEFAULT 0,
  source_sheet_name TEXT,
  source_file_name TEXT,
  source_row_no INTEGER,
  source_raw_json TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_cmi_category ON cost_master_items(category_code);
CREATE INDEX idx_cmi_calc_type ON cost_master_items(calculation_type);
CREATE INDEX idx_cmi_active ON cost_master_items(is_active);
CREATE INDEX idx_cmi_display ON cost_master_items(category_code, display_order);
CREATE INDEX idx_cmi_cat_active_order ON cost_master_items(category_code, is_active, display_order);

-- ============================================================
-- 4. cost_master_item_versions（明細バージョン管理）
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_master_item_versions (
  id TEXT PRIMARY KEY,
  master_item_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  unit TEXT,
  calculation_type TEXT,
  unit_price REAL,
  fixed_amount REAL,
  quantity_reference_field TEXT,
  vendor_name TEXT,
  note TEXT,
  calculation_basis_note TEXT,
  rule_json TEXT DEFAULT '{}',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  change_reason TEXT,
  changed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (master_item_id) REFERENCES cost_master_items(id)
);

CREATE INDEX idx_cmiv_master ON cost_master_item_versions(master_item_id);
CREATE INDEX idx_cmiv_effective ON cost_master_item_versions(effective_from, effective_to);
CREATE UNIQUE INDEX idx_cmiv_unique ON cost_master_item_versions(master_item_id, version_no);

-- ============================================================
-- 5. cost_rule_conditions（条件ルール）
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_rule_conditions (
  id TEXT PRIMARY KEY,
  master_item_id TEXT NOT NULL,
  rule_group TEXT NOT NULL DEFAULT 'selection' CHECK (rule_group IN ('selection','calculation','warning','cross_category')),
  rule_name TEXT,
  priority INTEGER DEFAULT 100,
  conditions_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (master_item_id) REFERENCES cost_master_items(id)
);

CREATE INDEX idx_crc_item ON cost_rule_conditions(master_item_id);
CREATE INDEX idx_crc_group ON cost_rule_conditions(rule_group);
CREATE INDEX idx_crc_priority ON cost_rule_conditions(priority);

-- ============================================================
-- 6. quantity_rule_tables（数量算出ルール）
-- ============================================================
CREATE TABLE IF NOT EXISTS quantity_rule_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_item_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  reference_field TEXT NOT NULL,
  range_min REAL,
  range_max REAL,
  result_quantity REAL NOT NULL,
  extra_condition_json TEXT,
  note TEXT,
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  FOREIGN KEY (master_item_id) REFERENCES cost_master_items(id)
);

CREATE INDEX idx_qrt_item ON quantity_rule_tables(master_item_id);

-- ============================================================
-- 7. lineup_packages（Phase 2 用予約）
-- ============================================================
CREATE TABLE IF NOT EXISTS lineup_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_code TEXT NOT NULL,
  lineup TEXT NOT NULL,
  package_name TEXT NOT NULL,
  price_type TEXT NOT NULL CHECK (price_type IN ('fixed','per_tsubo')),
  price_amount REAL NOT NULL,
  included_items_json TEXT,
  note TEXT,
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT
);

CREATE INDEX idx_lp_category ON lineup_packages(category_code);
CREATE INDEX idx_lp_lineup ON lineup_packages(lineup);

-- ============================================================
-- 8. product_catalog（商品カタログ）
-- ============================================================
CREATE TABLE IF NOT EXISTS product_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_code TEXT NOT NULL,
  product_code TEXT UNIQUE NOT NULL,
  product_name TEXT NOT NULL,
  manufacturer TEXT,
  series TEXT,
  size_spec TEXT,
  unit TEXT,
  unit_price REAL NOT NULL,
  is_standard INTEGER DEFAULT 0,
  standard_for_lineup TEXT,
  note TEXT,
  price_source TEXT,
  price_source_date TEXT,
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT
);

CREATE INDEX idx_pc_category ON product_catalog(category_code);
CREATE INDEX idx_pc_standard ON product_catalog(is_standard);

-- ============================================================
-- 9. area_rules（地域・自治体ルール）
-- ============================================================
CREATE TABLE IF NOT EXISTS area_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL,
  prefecture TEXT,
  city TEXT,
  municipality_code TEXT,
  amount REAL,
  note TEXT,
  requires_confirmation INTEGER DEFAULT 0,
  reference_url TEXT,
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_ar_type ON area_rules(rule_type);
CREATE INDEX idx_ar_city ON area_rules(city);

-- ============================================================
-- 10. project_cost_items（案件別採用明細）
-- ============================================================
CREATE TABLE IF NOT EXISTS project_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  snapshot_id INTEGER,
  category_code TEXT NOT NULL,
  master_item_id TEXT,
  master_item_version_id TEXT,
  product_catalog_id INTEGER,
  item_name TEXT NOT NULL,
  unit TEXT,
  calculation_type TEXT,
  is_selected INTEGER DEFAULT 1,
  selection_reason TEXT,
  auto_quantity REAL,
  auto_unit_price REAL,
  auto_fixed_amount REAL,
  auto_amount REAL,
  manual_quantity REAL,
  manual_unit_price REAL,
  manual_amount REAL,
  override_reason TEXT,
  final_quantity REAL,
  final_unit_price REAL,
  final_amount REAL DEFAULT 0,
  vendor_name TEXT,
  calculation_basis_note TEXT,
  note TEXT,
  warning_text TEXT,
  review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending','confirmed','needs_review','flagged')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  evidence_file_key TEXT,
  version INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (master_item_id) REFERENCES cost_master_items(id),
  FOREIGN KEY (master_item_version_id) REFERENCES cost_master_item_versions(id),
  FOREIGN KEY (product_catalog_id) REFERENCES product_catalog(id)
);

CREATE INDEX idx_pci_project ON project_cost_items(project_id);
CREATE INDEX idx_pci_category ON project_cost_items(project_id, category_code);
CREATE INDEX idx_pci_review ON project_cost_items(review_status);
CREATE INDEX idx_pci_project_category_sort ON project_cost_items(project_id, category_code, sort_order);
CREATE INDEX idx_pci_snapshot ON project_cost_items(snapshot_id);

-- ============================================================
-- 11. project_cost_summaries（案件別工種集計）
-- ============================================================
CREATE TABLE IF NOT EXISTS project_cost_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category_code TEXT NOT NULL,
  auto_total_amount REAL DEFAULT 0,
  manual_adjustment_amount REAL DEFAULT 0,
  final_total_amount REAL DEFAULT 0,
  review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending','confirmed','needs_review','flagged')),
  review_comment TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  version INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE(project_id, category_code)
);

CREATE INDEX idx_pcs_project ON project_cost_summaries(project_id);

-- ============================================================
-- 12. project_warnings（案件別警告）— v4拡張
-- ============================================================
CREATE TABLE IF NOT EXISTS project_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  snapshot_id INTEGER,
  category_code TEXT,
  master_item_id TEXT,
  warning_type TEXT NOT NULL CHECK (warning_type IN (
    'missing_input','condition_unmet','threshold_exceeded',
    'area_surcharge','manual_required','cross_category',
    'sales_estimate_gap','master_price_expired','version_mismatch'
  )),
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info','warning','error')),
  message TEXT NOT NULL,
  recommendation TEXT,
  detail_json TEXT,
  is_resolved INTEGER DEFAULT 0,
  resolved_by INTEGER,
  resolved_at TEXT,
  resolved_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pw_project ON project_warnings(project_id);
CREATE INDEX idx_pw_unresolved ON project_warnings(project_id, is_resolved);
CREATE INDEX idx_pw_project_resolved ON project_warnings(project_id, is_resolved, severity);
CREATE INDEX idx_pw_snapshot ON project_warnings(snapshot_id);

-- ============================================================
-- 13. master_change_logs（マスタ変更履歴）
-- ============================================================
CREATE TABLE IF NOT EXISTS master_change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('create','update','deactivate','price_change','rule_change')),
  field_name TEXT,
  before_value TEXT,
  after_value TEXT,
  reason TEXT,
  changed_by INTEGER,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_mcl_target ON master_change_logs(target_table, target_id);
CREATE INDEX idx_mcl_date ON master_change_logs(changed_at);

-- ============================================================
-- 14. project_audit_logs（案件変更履歴）— v4拡張
-- ============================================================
CREATE TABLE IF NOT EXISTS project_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('project','cost_item','cost_summary','snapshot','sales_estimate')),
  target_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('create','update','recalculate','review','override','snapshot','regenerate')),
  field_name TEXT,
  before_value TEXT,
  after_value TEXT,
  note TEXT,
  changed_by INTEGER,
  changed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pal_project ON project_audit_logs(project_id);
CREATE INDEX idx_pal_date ON project_audit_logs(changed_at);
CREATE INDEX idx_pal_target ON project_audit_logs(target_type, target_id);

-- ============================================================
-- 15. app_users（ユーザー認証）— v4: users を置換
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_kana TEXT,
  role TEXT DEFAULT 'estimator' CHECK (role IN ('admin','manager','estimator','viewer')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  department TEXT,
  cloudflare_user_id TEXT,
  last_login_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_au_email ON app_users(email);
CREATE INDEX idx_au_role ON app_users(role);
CREATE INDEX idx_au_status ON app_users(status);

-- ============================================================
-- 16. project_phase_estimates（見積フェーズ管理）
-- ============================================================
CREATE TABLE IF NOT EXISTS project_phase_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  phase_type TEXT NOT NULL CHECK (phase_type IN ('consultation_rough','internal_estimate','contract_estimate','execution_budget')),
  phase_name TEXT,
  total_cost REAL,
  total_price REAL,
  gross_margin_rate REAL,
  snapshot_json TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_ppe_project ON project_phase_estimates(project_id);

-- ============================================================
-- 17. cost_snapshot_jobs（スナップショットジョブ管理）— v4新規
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_snapshot_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('initial','regenerate_preserve_reviewed','regenerate_auto_only','regenerate_replace_all')),
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  triggered_by INTEGER,
  trigger_reason TEXT,
  target_categories_json TEXT,
  preserve_manual_edits INTEGER DEFAULT 1,
  result_snapshot_id INTEGER,
  items_processed INTEGER DEFAULT 0,
  items_changed INTEGER DEFAULT 0,
  warnings_generated INTEGER DEFAULT 0,
  error_message TEXT,
  error_detail_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_csj_project ON cost_snapshot_jobs(project_id);
CREATE INDEX idx_csj_status ON cost_snapshot_jobs(status);
CREATE INDEX idx_csj_project_active ON cost_snapshot_jobs(project_id, status);

-- ============================================================
-- 18. project_cost_snapshots（原価スナップショット）— v4新規
-- ============================================================
CREATE TABLE IF NOT EXISTS project_cost_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  snapshot_no INTEGER NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','superseded','archived')),
  total_cost REAL DEFAULT 0,
  total_standard_cost REAL DEFAULT 0,
  total_solar_cost REAL DEFAULT 0,
  total_option_cost REAL DEFAULT 0,
  estimated_sale_price REAL DEFAULT 0,
  overall_margin_rate REAL DEFAULT 0,
  items_count INTEGER DEFAULT 0,
  categories_count INTEGER DEFAULT 0,
  confirmed_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  project_conditions_json TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (job_id) REFERENCES cost_snapshot_jobs(id),
  UNIQUE(project_id, snapshot_no)
);

CREATE INDEX idx_pcs2_project ON project_cost_snapshots(project_id);
CREATE INDEX idx_pcs2_status ON project_cost_snapshots(project_id, status);

-- ============================================================
-- 19. project_cost_regeneration_diffs（再生成差分）— v4新規
-- ============================================================
CREATE TABLE IF NOT EXISTS project_cost_regeneration_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  old_snapshot_id INTEGER,
  new_snapshot_id INTEGER NOT NULL,
  category_code TEXT NOT NULL,
  master_item_id TEXT,
  item_name TEXT,
  diff_type TEXT NOT NULL CHECK (diff_type IN (
    'amount_changed','quantity_changed','unit_price_changed',
    'fixed_amount_changed','selection_changed','item_added','item_removed'
  )),
  old_value TEXT,
  new_value TEXT,
  change_amount REAL,
  change_percent REAL,
  is_significant INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES cost_snapshot_jobs(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pcrd_job ON project_cost_regeneration_diffs(job_id);
CREATE INDEX idx_pcrd_project ON project_cost_regeneration_diffs(project_id);
CREATE INDEX idx_pcrd_category ON project_cost_regeneration_diffs(category_code);
CREATE INDEX idx_pcrd_significant ON project_cost_regeneration_diffs(job_id, is_significant);

-- ============================================================
-- 20. project_sales_estimates（売価見積）— v4新規
-- ============================================================
CREATE TABLE IF NOT EXISTS project_sales_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  snapshot_id INTEGER,
  estimate_type TEXT NOT NULL CHECK (estimate_type IN ('rough','internal','contract','execution')),
  total_cost REAL NOT NULL DEFAULT 0,
  total_sale_price REAL NOT NULL DEFAULT 0,
  gross_margin_rate REAL,
  discount_amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  standard_cost REAL DEFAULT 0,
  standard_sale REAL DEFAULT 0,
  solar_cost REAL DEFAULT 0,
  solar_sale REAL DEFAULT 0,
  option_cost REAL DEFAULT 0,
  option_sale REAL DEFAULT 0,
  note TEXT,
  detail_json TEXT,
  is_current INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pse_project ON project_sales_estimates(project_id);
CREATE INDEX idx_pse_type ON project_sales_estimates(estimate_type);
CREATE INDEX idx_pse_current ON project_sales_estimates(project_id, is_current);

-- ============================================================
-- 21. project_input_sources（入力ソース管理）— v4新規
-- ============================================================
CREATE TABLE IF NOT EXISTS project_input_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual','spreadsheet','ai_extract','api_import','seed_data')),
  source_name TEXT,
  source_detail TEXT,
  r2_file_key TEXT,
  items_extracted INTEGER DEFAULT 0,
  items_applied INTEGER DEFAULT 0,
  extraction_json TEXT,
  processed_by INTEGER,
  processed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pis_project ON project_input_sources(project_id);
CREATE INDEX idx_pis_type ON project_input_sources(source_type);

-- ============================================================
-- 22. external_references（外部参照情報）— v4新規
-- ============================================================
CREATE TABLE IF NOT EXISTS external_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'vendor_quote','catalog_price','municipal_fee','historical_data','drawing','regulation'
  )),
  title TEXT NOT NULL,
  description TEXT,
  reference_url TEXT,
  r2_file_key TEXT,
  project_id INTEGER,
  category_code TEXT,
  master_item_id TEXT,
  source_date TEXT,
  valid_until TEXT,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_er_type ON external_references(reference_type);
CREATE INDEX idx_er_project ON external_references(project_id);
CREATE INDEX idx_er_category ON external_references(category_code);

-- ============================================================
-- 23. system_settings（システム設定）— v4新規
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT UNIQUE NOT NULL,
  setting_type TEXT NOT NULL CHECK (setting_type IN ('threshold','default_value','feature_flag','notification','calculation')),
  setting_value TEXT NOT NULL,
  value_type TEXT DEFAULT 'string',
  description TEXT,
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_ss_key ON system_settings(setting_key);

-- ============================================================
-- 初期 system_settings データ
-- ============================================================
INSERT INTO system_settings (setting_key, setting_type, setting_value, value_type, description) VALUES
  ('sales_gap_warning_threshold', 'threshold', '10', 'number', '売価乖離率 警告閾値(%)'),
  ('sales_gap_error_threshold', 'threshold', '20', 'number', '売価乖離率 エラー閾値(%)'),
  ('default_standard_margin_rate', 'default_value', '30.0', 'number', '標準粗利率デフォルト'),
  ('default_solar_margin_rate', 'default_value', '25.0', 'number', '太陽光粗利率デフォルト'),
  ('default_option_margin_rate', 'default_value', '30.0', 'number', 'オプション粗利率デフォルト'),
  ('batch_size_limit', 'calculation', '100', 'number', 'D1バッチサイズ上限'),
  ('enable_ai_condition_check', 'feature_flag', 'true', 'boolean', 'AI条件チェック機能有効'),
  ('lock_conflict_alert_threshold', 'threshold', '5', 'number', '楽観ロック衝突アラート閾値(/時)'),
  ('price_expiry_warning_days', 'threshold', '30', 'number', '単価期限切れ警告（日数前）');
