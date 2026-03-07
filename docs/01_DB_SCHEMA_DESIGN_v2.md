# D1 テーブル設計 v2（改訂版）

> **改訂履歴**: 07_CROSS_REVIEW_AND_RESOLUTIONS.md の指摘事項 C-01〜C-10, T-01〜T-08, O-02〜O-05, S-03〜S-05 を反映。

## 設計方針

1. **現行スプレッドシートの構造を忠実に再現**する
2. **単価スナップショット**：案件作成時点のマスタ単価を案件明細に固定する
3. **バージョン管理**：明細マスタの単価変更履歴を `cost_master_item_versions` で管理する
4. **変更履歴**：マスタ変更も案件変更も追跡可能にする
5. **拡張性**：Phase 2以降の商談概算・実績原価管理に対応できる余地を残す
6. **D1の制約考慮**：SQLiteベース、JOINは最小限、JSONカラムで柔軟性確保、バッチ100件制限対応
7. **シードファイルとの整合性**：マスタ系テーブルはTEXT PKを採用し、シードID体系をそのまま利用可能にする

---

## 用語統一（全ドキュメント共通）

| 用語 | 定義 | 旧表記との対照 |
|------|------|--------------|
| 工種（37工種） | 太陽光・オプション含む全工事カテゴリ | 旧「35工種+2カテゴリ」 |
| 計算方式（12パターン） | `fixed_amount` 他11種 | 旧「10パターン」 |
| 粗利グループ | standard / solar / option | `gross_margin_group` に統一 |
| 明細グループ | basic / extra / option | `item_group` は `basic / extra / option` に統一 |

---

## テーブル一覧

| # | テーブル名 | 役割 | PK方式 | レコード規模 |
|---|-----------|------|--------|-------------|
| 1 | projects | 案件マスタ | INTEGER AUTO | 年間50〜120件 |
| 2 | cost_categories | 工種マスタ | TEXT | **37件（固定）** |
| 3 | cost_master_items | 明細マスタ（単価表） | TEXT | 約300〜500件 |
| 4 | **cost_master_item_versions** | **明細バージョン管理（新設）** | TEXT | 蓄積（初期=明細数） |
| 5 | cost_rule_conditions | 条件ルール（**JSON構造に変更**） | TEXT | 約100〜200件 |
| 6 | quantity_rule_tables | 数量算出ルール（WB部材等） | INTEGER AUTO | 約50〜100件 |
| 7 | lineup_packages | ラインナップ別パッケージ（**Phase 2用予約**） | INTEGER AUTO | 約30〜50件 |
| 8 | product_catalog | 商品カタログ（サッシ・建具等） | INTEGER AUTO | 約200〜500件 |
| 9 | area_rules | 地域・自治体ルール | INTEGER AUTO | 約30〜50件 |
| 10 | project_cost_items | 案件別採用明細 | INTEGER AUTO | 案件あたり50〜100件 |
| 11 | project_cost_summaries | 案件別工種集計 | INTEGER AUTO | 案件あたり37件 |
| 12 | project_warnings | 案件別警告・要確認 | INTEGER AUTO | 案件あたり10〜20件 |
| 13 | master_change_logs | マスタ変更履歴 | INTEGER AUTO | 蓄積 |
| 14 | project_audit_logs | 案件変更履歴 | INTEGER AUTO | 蓄積 |
| 15 | users | ユーザー | INTEGER AUTO | 約10〜30名 |
| 16 | project_phase_estimates | 見積フェーズ管理 | INTEGER AUTO | 案件あたり1〜4件 |

---

## CREATE TABLE 文

### 1. projects（案件マスタ）

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE NOT NULL,        -- 案件コード（自動採番: YYYY-NNN）
  project_name TEXT NOT NULL,
  customer_name TEXT,
  customer_name_2 TEXT,

  -- 建築地情報
  prefecture TEXT,
  city TEXT,
  address_text TEXT,
  municipality_code TEXT,
  is_shizuoka_prefecture INTEGER DEFAULT 1, -- 静岡県内フラグ（産廃ルール用）

  -- ラインナップ・仕様
  lineup TEXT NOT NULL,                     -- SHIN / RIN / MOKU_OOYANE / MOKU_HIRAYA / MOKU_ROKU
  insulation_grade TEXT,                    -- 断熱等級（"5" or "6"）※文字列型に変更
  has_wb INTEGER DEFAULT 1,
  fire_zone_type TEXT DEFAULT 'standard',

  -- 面積・寸法
  tsubo REAL,
  building_area_m2 REAL,
  floor1_area_m2 REAL,
  floor2_area_m2 REAL,
  total_floor_area_m2 REAL,
  exterior_wall_area_m2 REAL,
  roof_shape TEXT,
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
  has_yakisugi INTEGER DEFAULT 0,           -- 焼杉採用（木工事連動）
  yakisugi_area_m2 REAL,                    -- 焼杉面積
  is_cleaning_area_standard INTEGER DEFAULT 1, -- 美装標準エリア内

  -- 粗利率設定
  standard_gross_margin_rate REAL DEFAULT 30.0,
  solar_gross_margin_rate REAL DEFAULT 25.0,
  option_gross_margin_rate REAL DEFAULT 30.0,  -- オプション粗利率（追加）

  -- ステータス
  status TEXT DEFAULT 'draft',
  assigned_to INTEGER,
  reviewer_id INTEGER,

  -- 楽観ロック（O-02対応）
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

**変更点**:
- `insulation_grade` を `TEXT` に変更（シードファイルが `"5"`, `"6"` の文字列を使用するため）
- `is_shizuoka_prefecture`, `has_yakisugi`, `yakisugi_area_m2`, `is_cleaning_area_standard` を追加（ルール条件参照用）
- `option_gross_margin_rate` を追加
- `version` を追加（楽観ロック用）

---

### 2. cost_categories（工種マスタ）**37工種**

```sql
CREATE TABLE IF NOT EXISTS cost_categories (
  id TEXT PRIMARY KEY,                       -- cat_foundation 等（シードIDをそのまま使用）
  category_code TEXT UNIQUE NOT NULL,
  category_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  requires_review INTEGER DEFAULT 0,
  gross_margin_group TEXT DEFAULT 'standard', -- standard / solar / option（名前統一）
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_cc_sort ON cost_categories(sort_order);
CREATE INDEX idx_cc_active ON cost_categories(is_active);
```

**変更点**:
- PK を `TEXT` に変更（シードの `cat_foundation` 等をそのまま使用）
- `margin_group` → `gross_margin_group` に名前統一

**全37工種（カテゴリコード統一済み）**:

| sort_order | id | category_code | category_name | gross_margin_group |
|-----------|-----|--------------|--------------|-------------------|
| 10 | cat_site_survey | site_survey | 外部敷地調査 | standard |
| 20 | cat_design | design | 設計業務 | standard |
| 30 | cat_ground_survey | ground_survey | 地盤調査 | standard |
| 40 | cat_earthwork | earthwork | 土工事 | standard |
| 50 | cat_temporary | temporary | 仮設工事 | standard |
| 60 | cat_scaffolding | scaffolding | 足場工事 | standard |
| 70 | cat_termite | termite | 防蟻工事 | standard |
| 80 | cat_foundation | foundation | 基礎工事 | standard |
| 90 | cat_precut | precut | プレカット・はがら下地材 | standard |
| 100 | cat_insulation | insulation | 断熱材 | standard |
| 110 | cat_shinkabe_panel | shinkabe_panel | 真壁パネル | standard |
| 120 | cat_exterior_wall | exterior_wall | 外壁工事 | standard |
| 130 | cat_building_materials | building_materials | 建材・副資材 | standard |
| 140 | cat_hardware | hardware | 金物 | standard |
| 150 | cat_crane | crane | レッカー | standard |
| 160 | cat_wb_parts | wb_parts | WB部材 | standard |
| 170 | cat_sash | sash | サッシ・鋼製建具 | standard |
| 180 | cat_interior_doors | interior_doors | 内装建具 | standard |
| 190 | cat_lighting_equipment | lighting_equipment | 照明・電気設備機器 | standard |
| 200 | cat_plastering | plastering | 左官工事 | standard |
| 210 | cat_roof | roof | 屋根工事 | standard |
| 220 | cat_tile_stone | tile_stone | タイル・石工事 | standard |
| 230 | cat_interior_finish | interior_finish | 内装仕上工事 | standard |
| 240 | cat_electrical_facility | electrical_facility | 電気設備工事 | standard |
| 250 | cat_plumbing | plumbing | 水道工事 | standard |
| 260 | cat_tatami | tatami | 畳工事 | standard |
| 270 | cat_septic_tank | septic_tank | 浄化槽工事 | standard |
| 280 | cat_cleaning | cleaning | 美装工事 | standard |
| 290 | cat_waste_box | waste_box | 産廃ボックス | standard |
| 300 | cat_external_audit | external_audit | 外注監査 | standard |
| 310 | cat_defect_insurance | defect_insurance | 瑕疵担保保険 | standard |
| 320 | cat_housing_equipment | housing_equipment | 住宅設備 | standard |
| 330 | cat_carpentry | carpentry | 木工事 | standard |
| 340 | cat_furniture | furniture | 家具製造 | standard |
| 350 | cat_site_management | site_management | 現場管理費 | standard |
| 360 | cat_solar | solar | 太陽光工事 | solar |
| 370 | cat_options | options | オプション | option |

---

### 3. cost_master_items（明細マスタ / 単価表）

```sql
CREATE TABLE IF NOT EXISTS cost_master_items (
  id TEXT PRIMARY KEY,                       -- item_foundation_lt60 等
  category_code TEXT NOT NULL,               -- 工種コード（FKではなくコードで参照）
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT,

  -- 金額（C-06対応: unit_priceとfixed_amountを明確に分離）
  base_unit_price REAL,                      -- 単価（数量×単価の場合）
  base_fixed_amount REAL,                    -- 固定額（数量によらない場合）

  -- 計算方式（C-02対応: 12パターン）
  calculation_type TEXT NOT NULL,            -- fixed_amount / per_tsubo / per_m2 / per_meter
                                             -- per_piece / range_lookup / lineup_fixed
                                             -- rule_lookup / manual_quote / product_selection
                                             -- package_with_delta / threshold_surcharge
  quantity_reference_field TEXT,              -- 参照する案件項目名

  -- 分類（S-03対応: basic/extra/option）
  item_group TEXT DEFAULT 'basic',           -- basic / extra / option
  section_type TEXT DEFAULT 'basic',         -- シード互換（basic / extra）
  default_selected INTEGER DEFAULT 0,
  requires_manual_confirmation INTEGER DEFAULT 0,

  -- AI チェック（S-04対応）
  ai_check_target INTEGER DEFAULT 1,

  -- 発注先
  vendor_name TEXT,
  vendor_code TEXT,

  -- 説明・根拠（T-07対応: カラム名統一）
  note TEXT,
  calculation_basis_note TEXT,               -- 算出根拠（旧 calculation_basis）
  warning_message TEXT,

  -- 有効期間
  valid_from TEXT,
  valid_to TEXT,
  price_source TEXT,
  price_source_date TEXT,

  -- 表示順（S-05対応）
  display_order INTEGER DEFAULT 0,

  -- トレーサビリティ（T-08対応）
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
```

---

### 4. cost_master_item_versions（明細バージョン管理）**新設: C-04対応**

```sql
CREATE TABLE IF NOT EXISTS cost_master_item_versions (
  id TEXT PRIMARY KEY,                       -- ver_item_foundation_lt60_v1 等
  master_item_id TEXT NOT NULL,              -- 親明細ID
  version_no INTEGER NOT NULL,
  unit TEXT,
  calculation_type TEXT,
  unit_price REAL,
  fixed_amount REAL,
  quantity_reference_field TEXT,
  vendor_name TEXT,
  note TEXT,
  calculation_basis_note TEXT,
  rule_json TEXT DEFAULT '{}',               -- バージョン固有のルール設定
  effective_from TEXT NOT NULL,
  effective_to TEXT,                          -- NULLなら現在有効
  change_reason TEXT,
  changed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (master_item_id) REFERENCES cost_master_items(id)
);

CREATE INDEX idx_cmiv_master ON cost_master_item_versions(master_item_id);
CREATE INDEX idx_cmiv_effective ON cost_master_item_versions(effective_from, effective_to);
CREATE UNIQUE INDEX idx_cmiv_unique ON cost_master_item_versions(master_item_id, version_no);
```

---

### 5. cost_rule_conditions（条件ルール）**C-07対応: JSON構造に変更**

```sql
CREATE TABLE IF NOT EXISTS cost_rule_conditions (
  id TEXT PRIMARY KEY,                       -- rule_foundation_lt60 等
  master_item_id TEXT NOT NULL,              -- 対象明細ID
  rule_group TEXT NOT NULL DEFAULT 'selection', -- selection / calculation / warning / cross_category
  rule_name TEXT,
  priority INTEGER DEFAULT 100,

  -- 条件・アクション（JSON配列）
  conditions_json TEXT NOT NULL DEFAULT '[]', -- [{field, operator, value}, ...]
  actions_json TEXT NOT NULL DEFAULT '[]',    -- [{type, value}, ...]

  -- 演算子: = / != / > / >= / < / <= / in / not_in / between
  -- アクション種別: select / deselect / set_quantity / set_fixed_amount
  --                set_unit_price / set_reference_field / flag_manual_confirmation
  --                show_warning / add_amount

  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (master_item_id) REFERENCES cost_master_items(id)
);

CREATE INDEX idx_crc_item ON cost_rule_conditions(master_item_id);
CREATE INDEX idx_crc_group ON cost_rule_conditions(rule_group);
CREATE INDEX idx_crc_priority ON cost_rule_conditions(priority);
```

---

### 6. quantity_rule_tables（数量算出ルール）

```sql
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
```

---

### 7. lineup_packages（ラインナップ別パッケージ）**Phase 2用予約**

> **注意**: Phase 1 では `cost_master_items` + `cost_rule_conditions` で管理。
> このテーブルは Phase 2 の住宅設備パック等の複合パッケージ管理用。

```sql
CREATE TABLE IF NOT EXISTS lineup_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_code TEXT NOT NULL,
  lineup TEXT NOT NULL,
  package_name TEXT NOT NULL,
  price_type TEXT NOT NULL,                  -- fixed / per_tsubo
  price_amount REAL NOT NULL,
  included_items_json TEXT,
  note TEXT,
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT
);

CREATE INDEX idx_lp_category ON lineup_packages(category_code);
CREATE INDEX idx_lp_lineup ON lineup_packages(lineup);
```

---

### 8. product_catalog（商品カタログ）

```sql
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
```

---

### 9. area_rules（地域・自治体ルール）

変更なし（前版と同一）。

```sql
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
```

---

### 10. project_cost_items（案件別採用明細）

```sql
CREATE TABLE IF NOT EXISTS project_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category_code TEXT NOT NULL,
  master_item_id TEXT,                       -- NULLの場合は手動追加明細
  master_item_version_id TEXT,               -- スナップショット元のバージョンID（新設）
  product_catalog_id INTEGER,

  -- 項目情報（マスタからスナップショット）
  item_name TEXT NOT NULL,
  unit TEXT,
  calculation_type TEXT,                     -- スナップショット時の計算方式

  -- 採用状態
  is_selected INTEGER DEFAULT 1,
  selection_reason TEXT,

  -- 自動計算値
  auto_quantity REAL,
  auto_unit_price REAL,
  auto_fixed_amount REAL,                    -- 固定額のスナップショット（追加）
  auto_amount REAL,

  -- 手修正値
  manual_quantity REAL,
  manual_unit_price REAL,
  manual_amount REAL,
  override_reason TEXT,                      -- 手修正理由（手修正がある場合は必須）

  -- 最終確定値（T-01対応: 算出ロジック明文化）
  -- final_quantity = manual_quantity ?? auto_quantity
  -- final_unit_price = manual_unit_price ?? auto_unit_price
  -- final_amount = manual_amount ?? (final_quantity * final_unit_price) ?? auto_amount
  final_quantity REAL,
  final_unit_price REAL,
  final_amount REAL DEFAULT 0,

  -- メタ情報
  vendor_name TEXT,
  calculation_basis_note TEXT,               -- カラム名統一
  note TEXT,
  warning_text TEXT,

  -- 確認ステータス
  review_status TEXT DEFAULT 'pending',      -- pending / confirmed / needs_review / flagged
  reviewed_by INTEGER,
  reviewed_at TEXT,

  -- 添付
  evidence_file_key TEXT,

  -- 楽観ロック（O-02対応）
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
```

---

### 11. project_cost_summaries（案件別工種集計）

```sql
CREATE TABLE IF NOT EXISTS project_cost_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category_code TEXT NOT NULL,

  auto_total_amount REAL DEFAULT 0,
  manual_adjustment_amount REAL DEFAULT 0,
  final_total_amount REAL DEFAULT 0,

  review_status TEXT DEFAULT 'pending',
  review_comment TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,

  -- 楽観ロック
  version INTEGER DEFAULT 1,

  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE(project_id, category_code)
);

CREATE INDEX idx_pcs_project ON project_cost_summaries(project_id);
```

---

### 12〜16. その他テーブル

project_warnings, master_change_logs, project_audit_logs, users, project_phase_estimates は前版と同一（変更なし）。

---

## final_* 値の算出ロジック（T-01対応）

```
--- 明細保存時のロジック ---

final_quantity =
  CASE
    WHEN manual_quantity IS NOT NULL THEN manual_quantity
    ELSE auto_quantity
  END

final_unit_price =
  CASE
    WHEN manual_unit_price IS NOT NULL THEN manual_unit_price
    ELSE auto_unit_price
  END

final_amount =
  CASE
    WHEN manual_amount IS NOT NULL THEN manual_amount
    WHEN manual_quantity IS NOT NULL OR manual_unit_price IS NOT NULL
      THEN final_quantity * final_unit_price
    WHEN auto_fixed_amount IS NOT NULL AND calculation_type IN ('fixed_amount', 'lineup_fixed')
      THEN auto_fixed_amount
    ELSE auto_amount
  END

--- バリデーション ---
IF manual_quantity IS NOT NULL OR manual_unit_price IS NOT NULL OR manual_amount IS NOT NULL:
  REQUIRE override_reason IS NOT NULL AND LENGTH(override_reason) > 0
```

---

## 再計算時の手修正保持ルール（T-02対応）

| 変更種別 | 手修正の扱い | 処理 |
|---------|-------------|------|
| 面積変更のみ | 手修正を保持 | `auto_*` のみ再計算、`manual_*` は維持 |
| ラインナップ変更 | 手修正をクリア | 全 `manual_*` をNULLに。旧値を `project_audit_logs` に記録 |
| 断熱等級変更 | 該当工種のみクリア | 断熱材・真壁パネルの `manual_*` のみNULLに |
| 個別工種の再計算 | 該当工種のみクリア | 指定工種の `manual_*` をNULLに |

---

## ER図（改訂版）

```
projects 1---* project_cost_items *---? cost_master_items *---1 cost_categories
    |                |                        |
    |                |                  cost_master_item_versions ← NEW
    |                |                  cost_rule_conditions
    |                |                  quantity_rule_tables
    |                |
    +---* project_cost_summaries (category_code参照)
    |
    +---* project_warnings
    |
    +---* project_audit_logs
    |
    +---* project_phase_estimates

cost_categories ---* cost_master_items (category_code)
cost_categories ---* lineup_packages (Phase 2, category_code)
cost_categories ---* product_catalog (category_code)

area_rules（独立参照）
users（独立参照）
master_change_logs（独立参照）
```

---

## D1固有の制約と対策

| 制約 | 対策 |
|------|------|
| バッチ100件制限 | メモリ上で全計算→100件ずつ分割→トランザクション内で連続実行 |
| JOINは最小限 | category_code での直接参照（JOINを回避） |
| JSONカラムの検索 | 検索には使わない。表示・復元用途に限定 |
| トランザクション | 案件保存・再計算時は必ずトランザクション使用 |

---

*最終更新: 2026-03-07*
*改訂番号: v2（07_CROSS_REVIEW反映）*
