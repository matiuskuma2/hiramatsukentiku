# D1 テーブル設計 v4（第4版）

> **改訂履歴**:
> - v2: 07_CROSS_REVIEW_AND_RESOLUTIONS.md の指摘事項 C-01〜C-10, T-01〜T-08 を反映
> - v3: 09_CROSS_REVIEW_PHASE2.md の指摘事項 NEW-01〜NEW-11 を反映
> - v4: スナップショットジョブ・再生成差分・売価見積・認証・システム設定の追加。diff_type/job_type のenum確定。CHECK制約の全面導入。projects に current_snapshot_id / revision_no 追加。users → app_users 置換。

## 設計方針

1. **現行スプレッドシートの構造を忠実に再現**する
2. **単価スナップショット**：案件作成時点のマスタ単価を案件明細に固定する
3. **バージョン管理**：明細マスタの単価変更履歴を `cost_master_item_versions` で管理する
4. **変更履歴**：マスタ変更も案件変更も追跡可能にする
5. **拡張性**：Phase 2以降の商談概算・実績原価管理に対応できる余地を残す
6. **D1の制約考慮**：SQLiteベース、JOINは最小限、JSONカラムで柔軟性確保、バッチ100件制限対応
7. **シードファイルとの整合性**：マスタ系テーブルはTEXT PKを採用し、シードID体系をそのまま利用可能にする
8. **CHECK制約**（v4追加）：全enumカラムに CHECK 制約。定義は 11_ENUM_STATUS_SPEC.md を正とする
9. **認証**（v4追加）：Cloudflare Access + `app_users` テーブルによるロールベースアクセス制御

---

## 用語統一（全ドキュメント共通）

| 用語 | 定義 | 旧表記との対照 |
|------|------|--------------|
| 工種（37工種） | 太陽光・オプション含む全工事カテゴリ | 旧「35工種+2カテゴリ」 |
| 計算方式（12パターン） | `fixed_amount` 他11種 | 旧「10パターン」 |
| 粗利グループ | standard / solar / option | `gross_margin_group` に統一 |
| 明細グループ | basic / extra / option | `item_group` は `basic / extra / option` に統一 |

---

## 金額カラム名マッピングルール（v3追加: NEW-04対応）

| データソース | 単価カラム名 | 固定額カラム名 | 用途 |
|-------------|-------------|--------------|------|
| **seed_items** (JSON) | `current_unit_price` | `current_fixed_amount` | シードファイルの現行値 |
| **cost_master_items** (DB) | `base_unit_price` | `base_fixed_amount` | マスタの基準値 |
| **seed_item_versions** (JSON) | `unit_price` | `fixed_amount` | シードのバージョン値 |
| **cost_master_item_versions** (DB) | `unit_price` | `fixed_amount` | バージョン管理値 |
| **project_cost_items** (DB) | `auto_unit_price` / `manual_unit_price` / `final_unit_price` | `auto_fixed_amount` | 案件明細の計算値 |

---

## テーブル一覧（v4: 25テーブル）

| # | テーブル名 | 役割 | PK方式 | レコード規模 | v4変更 |
|---|-----------|------|--------|-------------|--------|
| 1 | projects | 案件マスタ | INTEGER AUTO | 年間50〜120件 | **カラム追加** |
| 2 | cost_categories | 工種マスタ | TEXT | 37件（固定） | CHECK追加 |
| 3 | cost_master_items | 明細マスタ（単価表） | TEXT | 約300〜500件 | CHECK追加 |
| 4 | cost_master_item_versions | 明細バージョン管理 | TEXT | 蓄積 | — |
| 5 | cost_rule_conditions | 条件ルール（JSON構造） | TEXT | 約100〜200件 | CHECK追加 |
| 6 | quantity_rule_tables | 数量算出ルール | INTEGER AUTO | 約50〜100件 | — |
| 7 | lineup_packages | ラインナップ別パッケージ（Phase 2用） | INTEGER AUTO | 約30〜50件 | CHECK追加 |
| 8 | product_catalog | 商品カタログ | INTEGER AUTO | 約200〜500件 | — |
| 9 | area_rules | 地域・自治体ルール | INTEGER AUTO | 約30〜50件 | — |
| 10 | project_cost_items | 案件別採用明細 | INTEGER AUTO | 案件あたり50〜100件 | CHECK追加 |
| 11 | project_cost_summaries | 案件別工種集計 | INTEGER AUTO | 案件あたり37件 | CHECK追加 |
| 12 | project_warnings | 案件別警告・要確認 | INTEGER AUTO | 案件あたり10〜20件 | **v4拡張** |
| 13 | master_change_logs | マスタ変更履歴 | INTEGER AUTO | 蓄積 | CHECK追加 |
| 14 | project_audit_logs | 案件変更履歴 | INTEGER AUTO | 蓄積 | **v4拡張** |
| 15 | ~~users~~ → **app_users** | ユーザー認証 | INTEGER AUTO | 約10〜30名 | **v4置換** |
| 16 | project_phase_estimates | 見積フェーズ管理 | INTEGER AUTO | 案件あたり1〜4件 | CHECK追加 |
| 17 | **cost_snapshot_jobs** | スナップショットジョブ管理 | INTEGER AUTO | 案件あたり数件 | **v4新規** |
| 18 | **project_cost_snapshots** | 原価スナップショット | INTEGER AUTO | 案件あたり1〜5件 | **v4新規** |
| 19 | **project_cost_regeneration_diffs** | 再生成差分 | INTEGER AUTO | 再生成あたり10〜50件 | **v4新規** |
| 20 | **project_sales_estimates** | 売価見積 | INTEGER AUTO | 案件あたり1〜4件 | **v4新規** |
| 21 | **project_input_sources** | 入力ソース管理 | INTEGER AUTO | 蓄積 | **v4新規** |
| 22 | **external_references** | 外部参照情報 | INTEGER AUTO | 蓄積 | **v4新規** |
| 23 | **system_settings** | システム設定 | INTEGER AUTO | 約20〜50件 | **v4新規** |

> **v4変更点**: `users` テーブルを `app_users` に置換（Cloudflare Access 連携対応）。新規テーブル7個追加。`projects` にカラム追加。`project_warnings` / `project_audit_logs` を拡張。

---

## CREATE TABLE 文

### 1. projects（案件マスタ）— v4改訂

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE NOT NULL,
  project_name TEXT NOT NULL,
  customer_name TEXT,
  customer_name_2 TEXT,

  -- 建築地情報
  prefecture TEXT,
  city TEXT,
  address_text TEXT,
  municipality_code TEXT,
  is_shizuoka_prefecture INTEGER DEFAULT 1,

  -- ラインナップ・仕様
  lineup TEXT NOT NULL CHECK (lineup IN ('SHIN','RIN','MOKU_OOYANE','MOKU_HIRAYA','MOKU_ROKU')),
  insulation_grade TEXT CHECK (insulation_grade IS NULL OR insulation_grade IN ('5','6')),
  has_wb INTEGER DEFAULT 1,
  fire_zone_type TEXT DEFAULT 'standard' CHECK (fire_zone_type IN ('standard','semi_fire','fire')),

  -- 面積・寸法
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

  -- 建物特性
  is_one_story INTEGER DEFAULT 0,
  is_two_family INTEGER DEFAULT 0,
  has_loft INTEGER DEFAULT 0,
  loft_tsubo REAL DEFAULT 0,
  has_dormer INTEGER DEFAULT 0,
  dormer_tsubo REAL DEFAULT 0,
  flat_roof_floor1_area_m2 REAL DEFAULT 0,

  -- 太陽光・蓄電池
  has_pv INTEGER DEFAULT 0,
  pv_capacity_kw REAL,
  pv_panels INTEGER,
  has_battery INTEGER DEFAULT 0,
  battery_capacity_kwh REAL,

  -- 給排水関連
  plumbing_distance_m REAL,
  has_water_intake INTEGER DEFAULT 0,
  has_sewer_intake INTEGER DEFAULT 0,
  has_water_meter INTEGER DEFAULT 1,

  -- 玄関・ポーチ
  entrance_floor_area_m2 REAL,
  entrance_baseboard_length_m REAL,
  porch_area_m2 REAL,
  porch_riser_length_m REAL,

  -- 内装仕上用
  interior_wall_area_m2 REAL,
  ceiling_area_m2 REAL,

  -- 工種間連動用フラグ
  has_yakisugi INTEGER DEFAULT 0,
  yakisugi_area_m2 REAL,
  is_cleaning_area_standard INTEGER DEFAULT 1,

  -- 粗利率設定
  standard_gross_margin_rate REAL DEFAULT 30.0,
  solar_gross_margin_rate REAL DEFAULT 25.0,
  option_gross_margin_rate REAL DEFAULT 30.0,

  -- ステータス
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','calculating','in_progress','needs_review','reviewed','archived')),
  assigned_to INTEGER,
  reviewer_id INTEGER,

  -- v4追加: スナップショット連携
  current_snapshot_id INTEGER,          -- 現在有効なスナップショットID（NULLable、FK はアプリ層で保証）
  revision_no INTEGER DEFAULT 0,        -- リビジョン番号（スナップショット生成ごとにインクリメント）

  -- 楽観ロック
  version INTEGER DEFAULT 1,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_lineup ON projects(lineup);
CREATE INDEX idx_projects_customer ON projects(customer_name);
CREATE INDEX idx_projects_created ON projects(created_at);
CREATE INDEX idx_projects_code ON projects(project_code);
```

> **v4変更点**:
> - `current_snapshot_id INTEGER` 追加 — 現在有効スナップショットへの参照。NULLable。`project_cost_snapshots.id` を参照するが、循環参照を避けるため **FK制約はDB上に張らずアプリ層で保証**する。
> - `revision_no INTEGER DEFAULT 0` 追加 — スナップショット生成ごとにインクリメント。
> - `status` に `calculating` を追加。全値に CHECK 制約付与。
> - `lineup`, `insulation_grade`, `roof_shape`, `fire_zone_type` に CHECK 制約付与。

---

### 2〜9: v3から変更なし

テーブル2〜9（cost_categories, cost_master_items, cost_master_item_versions, cost_rule_conditions, quantity_rule_tables, lineup_packages, product_catalog, area_rules）は v3 定義を維持。CHECK制約のみ追加。

> **CHECK制約の追加対象**: 11_ENUM_STATUS_SPEC.md のセクション2〜4, 18に従い、以下のカラムに CHECK を付与:
> - `cost_categories.gross_margin_group`
> - `cost_master_items.calculation_type`, `item_group`, `section_type`
> - `cost_rule_conditions.rule_group`
> - `lineup_packages.price_type`
>
> CREATE TABLE 文は 01_DB_SCHEMA_DESIGN_v3.md を参照。v4で変更されるカラムはなし。

---

### 10. project_cost_items — CHECK制約追加

v3定義に以下の CHECK を追加:

```sql
-- review_status に CHECK 追加
review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending','confirmed','needs_review','flagged')),
```

その他は v3 と同一。

---

### 11. project_cost_summaries — CHECK制約追加

v3定義に以下の CHECK を追加:

```sql
review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending','confirmed','needs_review','flagged')),
```

---

### 12. project_warnings（案件別警告）— v4拡張

```sql
CREATE TABLE IF NOT EXISTS project_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  snapshot_id INTEGER,                  -- v4追加: 関連スナップショット
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
  detail_json TEXT,                     -- v4追加: 詳細データ（閾値、差額等）
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
```

> **v4変更点**: `snapshot_id`, `detail_json` 追加。`warning_type` に `sales_estimate_gap`, `master_price_expired`, `version_mismatch` を追加。全enum値にCHECK制約。
>
> **sales_estimate_gap 警告**: スナップショットジョブ完了時に評価。`system_settings` の閾値（例: `sales_gap_warning_threshold = 10`、`sales_gap_error_threshold = 20`、単位: %）と比較し、超過時に本テーブルへ INSERT する。

---

### 13. master_change_logs — CHECK制約追加

v3定義に以下のCHECKを追加:

```sql
change_type TEXT NOT NULL CHECK (change_type IN ('create','update','deactivate','price_change','rule_change')),
```

---

### 14. project_audit_logs — v4拡張

```sql
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
```

> **v4変更点**: `target_type` に `snapshot`, `sales_estimate` 追加。`action` に `snapshot`, `regenerate` 追加。`idx_pal_target` インデックス追加。

---

### 15. app_users（v4: users を置換）

```sql
CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,           -- Cloudflare Access の認証メールと一致
  name TEXT NOT NULL,
  name_kana TEXT,                       -- かな表記（ソート用）
  role TEXT DEFAULT 'estimator' CHECK (role IN ('admin','manager','estimator','viewer')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  department TEXT,                      -- 所属部門
  cloudflare_user_id TEXT,             -- Cloudflare Access のユーザーID（任意）
  last_login_at TEXT,
  is_active INTEGER DEFAULT 1,         -- 後方互換用（status='active' と同期）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_au_email ON app_users(email);
CREATE INDEX idx_au_role ON app_users(role);
CREATE INDEX idx_au_status ON app_users(status);
```

> **認証フロー**: Cloudflare Access が JWT を発行 → Workers で JWT 検証 → `app_users.email` で照合 → `role` でアクセス制御。未登録メールは `403 Forbidden`。
>
> **旧 users テーブルからの移行**: `users` テーブルは `app_users` に完全置換。マイグレーションで `users` を DROP し `app_users` を CREATE する。

---

### 16. project_phase_estimates — CHECK制約追加

v3定義に以下のCHECKを追加:

```sql
phase_type TEXT NOT NULL CHECK (phase_type IN ('consultation_rough','internal_estimate','contract_estimate','execution_budget')),
```

---

### 17. cost_snapshot_jobs（v4新規）

```sql
CREATE TABLE IF NOT EXISTS cost_snapshot_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('initial','regenerate_preserve_reviewed','regenerate_auto_only','regenerate_replace_all')),
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),

  -- ジョブパラメータ
  triggered_by INTEGER,                -- 実行者（app_users.id）
  trigger_reason TEXT,                 -- 実行理由（面積変更、ラインナップ変更等）
  target_categories_json TEXT,         -- NULL=全工種、JSON配列=指定工種のみ
  preserve_manual_edits INTEGER DEFAULT 1, -- 手修正保持フラグ

  -- 結果
  result_snapshot_id INTEGER,          -- 生成されたスナップショットID
  items_processed INTEGER DEFAULT 0,   -- 処理明細数
  items_changed INTEGER DEFAULT 0,     -- 変更明細数
  warnings_generated INTEGER DEFAULT 0, -- 生成警告数
  error_message TEXT,                  -- 失敗時のエラーメッセージ
  error_detail_json TEXT,              -- 失敗時の詳細情報

  -- 実行時間
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,                 -- 実行時間（ミリ秒）

  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_csj_project ON cost_snapshot_jobs(project_id);
CREATE INDEX idx_csj_status ON cost_snapshot_jobs(status);
CREATE INDEX idx_csj_project_active ON cost_snapshot_jobs(project_id, status);
```

> **排他制約（アプリ層）**: INSERT 前に `SELECT COUNT(*) FROM cost_snapshot_jobs WHERE project_id = ? AND status IN ('queued','running')` を実行。結果が 0 のときのみ INSERT を許可する。

---

### 18. project_cost_snapshots（v4新規）

```sql
CREATE TABLE IF NOT EXISTS project_cost_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,             -- 生成元ジョブID
  snapshot_no INTEGER NOT NULL,        -- スナップショット番号（project内で連番）
  status TEXT DEFAULT 'active' CHECK (status IN ('active','superseded','archived')),

  -- サマリー情報
  total_cost REAL DEFAULT 0,
  total_standard_cost REAL DEFAULT 0,
  total_solar_cost REAL DEFAULT 0,
  total_option_cost REAL DEFAULT 0,
  estimated_sale_price REAL DEFAULT 0,
  overall_margin_rate REAL DEFAULT 0,

  -- メタ情報
  items_count INTEGER DEFAULT 0,
  categories_count INTEGER DEFAULT 0,
  confirmed_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,

  -- スナップショット時点の案件条件
  project_conditions_json TEXT,        -- 案件の主要条件をJSON保存

  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (job_id) REFERENCES cost_snapshot_jobs(id),
  UNIQUE(project_id, snapshot_no)
);

CREATE INDEX idx_pcs2_project ON project_cost_snapshots(project_id);
CREATE INDEX idx_pcs2_status ON project_cost_snapshots(project_id, status);
```

> **projects.current_snapshot_id との関係**: `projects.current_snapshot_id` は本テーブルの `id` を参照する。新スナップショット生成時: (1) 旧スナップショットの `status` を `superseded` に更新、(2) 新スナップショットを `active` で INSERT、(3) `projects.current_snapshot_id` を新IDに UPDATE。

---

### 19. project_cost_regeneration_diffs（v4新規）

```sql
CREATE TABLE IF NOT EXISTS project_cost_regeneration_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,             -- 再生成ジョブID
  project_id INTEGER NOT NULL,
  old_snapshot_id INTEGER,             -- 比較元スナップショット
  new_snapshot_id INTEGER NOT NULL,    -- 比較先スナップショット

  -- 差分対象
  category_code TEXT NOT NULL,
  master_item_id TEXT,
  item_name TEXT,

  -- 差分種別
  diff_type TEXT NOT NULL CHECK (diff_type IN (
    'amount_changed','quantity_changed','unit_price_changed',
    'fixed_amount_changed','selection_changed','item_added','item_removed'
  )),

  -- 変更前後の値
  old_value TEXT,
  new_value TEXT,
  change_amount REAL,                  -- 金額差（新 - 旧）
  change_percent REAL,                 -- 変化率（%）

  -- 影響度
  is_significant INTEGER DEFAULT 0,    -- 閾値超過フラグ

  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (job_id) REFERENCES cost_snapshot_jobs(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pcrd_job ON project_cost_regeneration_diffs(job_id);
CREATE INDEX idx_pcrd_project ON project_cost_regeneration_diffs(project_id);
CREATE INDEX idx_pcrd_category ON project_cost_regeneration_diffs(category_code);
CREATE INDEX idx_pcrd_significant ON project_cost_regeneration_diffs(job_id, is_significant);
```

---

### 20. project_sales_estimates（v4新規）

```sql
CREATE TABLE IF NOT EXISTS project_sales_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  snapshot_id INTEGER,                 -- 関連スナップショット
  estimate_type TEXT NOT NULL CHECK (estimate_type IN ('rough','internal','contract','execution')),

  -- 金額情報
  total_cost REAL NOT NULL DEFAULT 0,
  total_sale_price REAL NOT NULL DEFAULT 0,
  gross_margin_rate REAL,
  discount_amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,

  -- 内訳
  standard_cost REAL DEFAULT 0,
  standard_sale REAL DEFAULT 0,
  solar_cost REAL DEFAULT 0,
  solar_sale REAL DEFAULT 0,
  option_cost REAL DEFAULT 0,
  option_sale REAL DEFAULT 0,

  -- メタ情報
  note TEXT,
  detail_json TEXT,                    -- 詳細内訳JSON
  is_current INTEGER DEFAULT 1,        -- 現在有効な見積か
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pse_project ON project_sales_estimates(project_id);
CREATE INDEX idx_pse_type ON project_sales_estimates(estimate_type);
CREATE INDEX idx_pse_current ON project_sales_estimates(project_id, is_current);
```

---

### 21. project_input_sources（v4新規）

```sql
CREATE TABLE IF NOT EXISTS project_input_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual','spreadsheet','ai_extract','api_import','seed_data')),

  -- ソース情報
  source_name TEXT,                    -- ファイル名、URL等
  source_detail TEXT,                  -- 詳細情報
  r2_file_key TEXT,                    -- R2に保存したファイルのキー

  -- 処理結果
  items_extracted INTEGER DEFAULT 0,
  items_applied INTEGER DEFAULT 0,
  extraction_json TEXT,                -- AI抽出結果のJSON

  processed_by INTEGER,
  processed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pis_project ON project_input_sources(project_id);
CREATE INDEX idx_pis_type ON project_input_sources(source_type);
```

---

### 22. external_references（v4新規）

```sql
CREATE TABLE IF NOT EXISTS external_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'vendor_quote','catalog_price','municipal_fee','historical_data','drawing','regulation'
  )),

  -- 参照情報
  title TEXT NOT NULL,
  description TEXT,
  reference_url TEXT,
  r2_file_key TEXT,                    -- R2保存ファイルキー

  -- 紐付け
  project_id INTEGER,                  -- 案件紐付け（NULLならマスタ全般）
  category_code TEXT,
  master_item_id TEXT,

  -- メタ
  source_date TEXT,                    -- 参照元の日付
  valid_until TEXT,                    -- 有効期限
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_er_type ON external_references(reference_type);
CREATE INDEX idx_er_project ON external_references(project_id);
CREATE INDEX idx_er_category ON external_references(category_code);
```

---

### 23. system_settings（v4新規）

```sql
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT UNIQUE NOT NULL,     -- 一意のキー名
  setting_type TEXT NOT NULL CHECK (setting_type IN ('threshold','default_value','feature_flag','notification','calculation')),
  setting_value TEXT NOT NULL,          -- 値（数値もTEXTで保存）
  value_type TEXT DEFAULT 'string',     -- string / number / boolean / json
  description TEXT,                     -- 設定の説明
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_ss_key ON system_settings(setting_key);
```

**初期データ例**:

| setting_key | setting_type | setting_value | description |
|-------------|-------------|---------------|-------------|
| `sales_gap_warning_threshold` | `threshold` | `10` | 売価乖離率 警告閾値(%) |
| `sales_gap_error_threshold` | `threshold` | `20` | 売価乖離率 エラー閾値(%) |
| `default_standard_margin_rate` | `default_value` | `30.0` | 標準粗利率デフォルト |
| `default_solar_margin_rate` | `default_value` | `25.0` | 太陽光粗利率デフォルト |
| `default_option_margin_rate` | `default_value` | `30.0` | オプション粗利率デフォルト |
| `batch_size_limit` | `calculation` | `100` | D1バッチサイズ上限 |
| `enable_ai_condition_check` | `feature_flag` | `true` | AI条件チェック機能有効 |
| `lock_conflict_alert_threshold` | `threshold` | `5` | 楽観ロック衝突アラート閾値(/時) |
| `price_expiry_warning_days` | `threshold` | `30` | 単価期限切れ警告（日数前） |

---

## final_* 値の算出ロジック（T-01対応）

v3と同一。変更なし。

---

## 再計算時の手修正保持ルール（T-02対応）

v3と同一。変更なし。

---

## ルール評価エンジンの型変換仕様（NEW-07対応）

v3と同一。詳細は 11_ENUM_STATUS_SPEC.md セクション21 を参照。

---

## ER図（v4改訂版）

```
projects 1---* project_cost_items *---? cost_master_items *---1 cost_categories
    |                |                        |
    |                |                  cost_master_item_versions
    |                |                  cost_rule_conditions
    |                |                  quantity_rule_tables
    |                |
    +---* project_cost_summaries
    |
    +---* project_warnings ←--- project_cost_snapshots (snapshot_id)
    |
    +---* project_audit_logs
    |
    +---* project_phase_estimates
    |
    +---* project_sales_estimates         ← v4新規
    |
    +---* project_input_sources           ← v4新規
    |
    +---? current_snapshot_id → project_cost_snapshots   ← v4新規（アプリ層FK）
    |
    +---* cost_snapshot_jobs              ← v4新規
             |
             +---1 project_cost_snapshots  ← v4新規
             |
             +---* project_cost_regeneration_diffs  ← v4新規

cost_categories ---* cost_master_items (category_code)
cost_categories ---* lineup_packages (Phase 2)
cost_categories ---* product_catalog (category_code)

area_rules（独立参照）
app_users（独立参照、認証用）              ← v4: users → app_users
external_references（独立/案件紐付け）     ← v4新規
system_settings（グローバル設定）          ← v4新規
master_change_logs（独立参照）
```

---

## D1固有の制約と対策

| 制約 | 対策 |
|------|------|
| バッチ100件制限 | メモリ上で全計算→100件ずつ分割→トランザクション内で連続実行 |
| JOINは最小限 | category_code での直接参照（JOINを回避） |
| JSONカラムの検索 | 検索には使わない。表示・復元用途に限定 |
| トランザクション | 案件保存・再計算・スナップショット生成時は必ずトランザクション使用 |
| FK制約 | D1(SQLite)ではデフォルト無効。投入順序で保証。`projects.current_snapshot_id` の循環FKはアプリ層で保証 |
| CHECK制約 | SQLiteはCHECK制約をサポート。全enumカラムに付与（11_ENUM_STATUS_SPEC.md 参照） |

---

## 認証設計概要（v4追加）

### Cloudflare Access + app_users によるロールベース認証

```
[ブラウザ] → [Cloudflare Access] → JWT発行 → [Workers] → JWT検証
                                                         ↓
                                               app_users.email で照合
                                                         ↓
                                               role に基づく権限チェック
                                                         ↓
                                               未登録 → 403 Forbidden
                                               inactive/suspended → 403 Forbidden
```

**実装方針**:
1. Cloudflare Access で Google Workspace / メール認証を設定
2. Workers のミドルウェアで JWT の `email` クレームを取得
3. `app_users` テーブルで `email` 照合し、`role` を取得
4. 各APIエンドポイントで `role` に基づくアクセス制御
5. 権限マトリクスは 11_ENUM_STATUS_SPEC.md セクション23 を参照

---

*最終更新: 2026-03-07*
*改訂番号: v4（スナップショット・認証・CHECK制約・新規テーブル追加）*
*正式版ドキュメント: 本 v4 を正とする。v3以前は参考資料。*
