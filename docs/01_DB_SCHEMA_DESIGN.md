# D1 テーブル設計

## 設計方針

1. **現行スプレッドシートの構造を忠実に再現**する
2. **単価スナップショット**：案件作成時点のマスタ単価を案件明細に固定する
3. **変更履歴**：マスタ変更も案件変更も追跡可能にする
4. **拡張性**：Phase 2以降の商談概算・実績原価管理に対応できる余地を残す
5. **D1の制約考慮**：SQLiteベース、JOINは最小限、JSONカラムで柔軟性確保

---

## テーブル一覧

| # | テーブル名 | 役割 | レコード規模 |
|---|-----------|------|-------------|
| 1 | projects | 案件マスタ | 年間50〜120件 |
| 2 | cost_categories | 工種マスタ | 約35件（固定） |
| 3 | cost_master_items | 明細マスタ（単価表） | 約300〜500件 |
| 4 | cost_rule_conditions | 条件ルール | 約100〜200件 |
| 5 | quantity_rule_tables | 数量算出ルール（WB部材等） | 約50〜100件 |
| 6 | lineup_packages | ラインナップ別パッケージ | 約30〜50件 |
| 7 | product_catalog | 商品カタログ（サッシ・建具等） | 約200〜500件 |
| 8 | area_rules | 地域・自治体ルール | 約30〜50件 |
| 9 | project_cost_items | 案件別採用明細 | 案件あたり50〜100件 |
| 10 | project_cost_summaries | 案件別工種集計 | 案件あたり35件 |
| 11 | project_warnings | 案件別警告・要確認 | 案件あたり10〜20件 |
| 12 | master_change_logs | マスタ変更履歴 | 蓄積 |
| 13 | project_audit_logs | 案件変更履歴 | 蓄積 |
| 14 | users | ユーザー | 約10〜30名 |
| 15 | project_phase_estimates | 見積フェーズ管理 | 案件あたり1〜4件 |

---

## CREATE TABLE 文

### 1. projects（案件マスタ）

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE NOT NULL,        -- 案件コード（例：2026-001）
  project_name TEXT NOT NULL,               -- 案件名
  customer_name TEXT,                       -- 顧客名
  customer_name_2 TEXT,                     -- 顧客名2（連名の場合）

  -- 建築地情報
  prefecture TEXT,                          -- 都道府県
  city TEXT,                                -- 市区町村
  address_text TEXT,                        -- 住所詳細
  municipality_code TEXT,                   -- 自治体コード

  -- ラインナップ・仕様
  lineup TEXT NOT NULL,                     -- SHIN / RIN / MOKU_OOYANE / MOKU_HIRAYA / MOKU_ROKU
  insulation_grade INTEGER,                 -- 断熱等級（5 or 6）
  has_wb INTEGER DEFAULT 1,                 -- WB工法（0=なし, 1=あり）
  fire_zone_type TEXT DEFAULT 'standard',   -- standard / semi_fireproof / fireproof

  -- 面積・寸法（Walk in Home/A'sから転記される基礎数値）
  tsubo REAL,                              -- 坪数（延床）
  building_area_m2 REAL,                   -- 建築面積(m2)
  floor1_area_m2 REAL,                     -- 1階床面積(m2)
  floor2_area_m2 REAL,                     -- 2階床面積(m2)
  total_floor_area_m2 REAL,                -- 延床面積(m2)
  exterior_wall_area_m2 REAL,              -- 外壁面積(m2)
  roof_shape TEXT,                          -- 屋根形状（kirizuma/yosemune/katanagaremune等）
  roof_area_m2 REAL,                       -- 屋根面積(m2)
  eaves_ceiling_area_m2 REAL,              -- 軒天面積(m2)
  gutter_length_m REAL,                    -- 軒樋長さ(m)
  downspout_length_m REAL,                 -- 竪樋長さ(m)
  roof_perimeter_m REAL,                   -- 屋根外周(m)
  foundation_perimeter_m REAL,             -- 基礎外周(m)

  -- 建物特性
  is_one_story INTEGER DEFAULT 0,          -- 平屋（0=2階建て, 1=平屋）
  is_two_family INTEGER DEFAULT 0,         -- 2世帯（0=単世帯, 1=2世帯）
  has_loft INTEGER DEFAULT 0,              -- ロフト有無
  loft_tsubo REAL DEFAULT 0,               -- ロフト坪数
  has_dormer INTEGER DEFAULT 0,            -- 下屋有無
  dormer_tsubo REAL DEFAULT 0,             -- 下屋坪数
  flat_roof_floor1_area_m2 REAL DEFAULT 0, -- 平屋部分1階床面積(m2)（2階が載っていない部分）

  -- 太陽光・蓄電池
  has_pv INTEGER DEFAULT 0,                -- 太陽光有無
  pv_capacity_kw REAL,                     -- 太陽光容量(kW)
  pv_panels INTEGER,                       -- パネル枚数
  has_battery INTEGER DEFAULT 0,           -- 蓄電池有無
  battery_capacity_kwh REAL,               -- 蓄電池容量(kWh)

  -- 給排水関連
  plumbing_distance_m REAL,                -- 給排水配管距離(m)
  has_water_intake INTEGER DEFAULT 0,      -- 給水引込み必要
  has_sewer_intake INTEGER DEFAULT 0,      -- 下水引込み必要
  has_water_meter INTEGER DEFAULT 1,       -- 水道メーター有無

  -- 玄関・ポーチ（タイル工事用）
  entrance_floor_area_m2 REAL,             -- 玄関床面積(m2)
  entrance_baseboard_length_m REAL,        -- 玄関巾木長(m)
  porch_area_m2 REAL,                      -- ポーチ面積(m2)
  porch_riser_length_m REAL,               -- ポーチ立上り長(m)

  -- 内装仕上用面積
  interior_wall_area_m2 REAL,              -- 内壁仕上面積(m2)
  ceiling_area_m2 REAL,                    -- 天井面積(m2)

  -- 粗利率設定
  standard_gross_margin_rate REAL DEFAULT 30.0,  -- 基本設定粗利率(%)
  solar_gross_margin_rate REAL DEFAULT 25.0,     -- 太陽光粗利率(%)

  -- ステータス
  status TEXT DEFAULT 'draft',             -- draft / in_progress / reviewed / confirmed / archived
  assigned_to INTEGER,                     -- 担当者ID
  reviewer_id INTEGER,                     -- レビュー者ID

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_lineup ON projects(lineup);
CREATE INDEX idx_projects_customer ON projects(customer_name);
CREATE INDEX idx_projects_created ON projects(created_at);
```

### 2. cost_categories（工種マスタ）

```sql
CREATE TABLE IF NOT EXISTS cost_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_code TEXT UNIQUE NOT NULL,       -- 工種コード
  category_name TEXT NOT NULL,              -- 工種名（日本語）
  sort_order INTEGER NOT NULL,              -- 表示順
  requires_review INTEGER DEFAULT 0,        -- 確認必須フラグ
  margin_group TEXT DEFAULT 'standard',     -- 粗利グループ（standard / solar / option）
  description TEXT,                         -- 説明
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**初期データ例（全35工種）：**

| sort_order | category_code | category_name | margin_group |
|-----------|--------------|--------------|-------------|
| 10 | site_survey | 外部敷地調査 | standard |
| 20 | design | 設計業務 | standard |
| 30 | ground_survey | 地盤調査 | standard |
| 40 | earthwork | 土工事 | standard |
| 50 | temporary | 仮設工事 | standard |
| 60 | scaffolding | 足場工事 | standard |
| 70 | termite | 防蟻工事 | standard |
| 80 | foundation | 基礎工事 | standard |
| 90 | precut | プレカット・はがら下地材 | standard |
| 100 | insulation | 断熱材 | standard |
| 110 | shinkabe_panel | 真壁パネル | standard |
| 120 | exterior_wall | 外壁工事 | standard |
| 130 | building_materials | 建材・副資材 | standard |
| 140 | hardware | 金物 | standard |
| 150 | crane | レッカー | standard |
| 160 | wb_parts | WB部材 | standard |
| 170 | sash | サッシ・鋼製建具 | standard |
| 180 | interior_doors | 内装建具 | standard |
| 190 | lighting_equipment | 照明・電気設備機器 | standard |
| 200 | plastering | 左官工事 | standard |
| 210 | roofing | 屋根工事 | standard |
| 220 | tile_stone | タイル・石工事 | standard |
| 230 | interior_finish | 内装仕上工事 | standard |
| 240 | electrical | 電気設備工事 | standard |
| 250 | plumbing | 水道工事 | standard |
| 260 | tatami | 畳工事 | standard |
| 270 | septic_tank | 浄化槽工事 | standard |
| 280 | cleaning | 美装工事 | standard |
| 290 | waste_disposal | 産廃ボックス | standard |
| 300 | external_audit | 外注監査 | standard |
| 310 | defect_insurance | 瑕疵担保保険 | standard |
| 320 | housing_equipment | 住宅設備 | standard |
| 330 | carpentry | 木工事 | standard |
| 340 | furniture | 家具製造 | standard |
| 350 | site_management | 現場管理費 | standard |
| 360 | solar | 太陽光工事 | solar |
| 370 | options | オプション | option |

### 3. cost_master_items（明細マスタ / 単価表）

```sql
CREATE TABLE IF NOT EXISTS cost_master_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,             -- 工種ID
  item_code TEXT UNIQUE NOT NULL,           -- 項目コード
  item_name TEXT NOT NULL,                  -- 項目名
  unit TEXT,                                -- 単位（式/坪/m2/m/台/枚/段/ヶ/本/セット等）
  base_unit_price REAL,                     -- 標準単価

  -- 計算方式
  calculation_type TEXT NOT NULL,           -- fixed_amount / per_tsubo / per_m2 / per_meter
                                            -- range_lookup / lineup_fixed / rule_lookup
                                            -- manual_quote / product_selection
                                            -- package_with_delta / threshold_surcharge
  reference_field TEXT,                     -- 参照する案件項目（tsubo / total_floor_area_m2 等）

  -- 分類
  item_group TEXT DEFAULT 'basic',          -- basic / additional / option
  is_default_selected INTEGER DEFAULT 0,   -- デフォルトで採用する項目か
  requires_manual_confirm INTEGER DEFAULT 0, -- 手動確認必須か

  -- 発注先
  vendor_name TEXT,                         -- 発注先
  vendor_code TEXT,                         -- 発注先コード

  -- 説明・根拠
  note TEXT,                                -- 備考
  calculation_basis TEXT,                   -- 算出根拠
  warning_message TEXT,                     -- 注意メッセージ（条件付き表示）

  -- 有効期間
  valid_from TEXT,                          -- 有効開始日
  valid_to TEXT,                            -- 有効終了日
  price_source TEXT,                        -- 単価根拠種別（internal_estimate / vendor_quote / negotiated / rule_based）
  price_source_date TEXT,                   -- 単価根拠日

  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (category_id) REFERENCES cost_categories(id)
);

CREATE INDEX idx_cost_master_category ON cost_master_items(category_id);
CREATE INDEX idx_cost_master_calc_type ON cost_master_items(calculation_type);
CREATE INDEX idx_cost_master_active ON cost_master_items(is_active);
```

### 4. cost_rule_conditions（条件ルール）

```sql
CREATE TABLE IF NOT EXISTS cost_rule_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,                 -- 対象明細ID
  rule_group TEXT,                          -- ルールグループ（同じグループはAND条件）
  rule_name TEXT,                           -- ルール名（人間可読）

  -- 条件定義
  condition_field TEXT NOT NULL,            -- 比較対象の案件項目
  operator TEXT NOT NULL,                   -- eq / ne / gt / gte / lt / lte / in / not_in / between
  condition_value TEXT NOT NULL,            -- 比較値（JSON形式も可：["SHIN","RIN"]）

  -- 条件成立時のアクション
  action_type TEXT NOT NULL,               -- auto_select / auto_deselect / add_amount / multiply
                                            -- set_unit_price / set_quantity / show_warning / require_confirm
  action_value TEXT,                        -- アクション値（金額、単価、数量、メッセージ等）

  priority INTEGER DEFAULT 0,              -- 優先度（高い方が優先）
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (item_id) REFERENCES cost_master_items(id)
);

CREATE INDEX idx_rules_item ON cost_rule_conditions(item_id);
CREATE INDEX idx_rules_field ON cost_rule_conditions(condition_field);
```

**ルール例：**

| item | condition_field | operator | condition_value | action_type | action_value |
|------|---------------|----------|----------------|-------------|-------------|
| 電気設備RIN加算 | lineup | eq | RIN | add_amount | 50000 |
| 断熱等級6屋根45mm | insulation_grade | eq | 6 | auto_select | - |
| 浄化槽7人槽 | total_floor_area_m2 | gte | 145 | auto_select | - |
| 浄化槽10人槽 | is_two_family | eq | 1 | auto_select | - |
| 産廃県外 | prefecture | ne | 静岡県 | auto_select | - |
| 美装エリア外 | city | not_in | ["豊川市",...,"菊川市"] | add_amount | 9000 |
| 水道70m超加算 | plumbing_distance_m | gt | 70 | show_warning | 70m超は別途加算 |

### 5. quantity_rule_tables（数量算出ルール）

WB部材の台数計算など、面積帯ルックアップ用。

```sql
CREATE TABLE IF NOT EXISTS quantity_rule_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,                 -- 対象明細ID
  rule_name TEXT NOT NULL,                  -- ルール名
  reference_field TEXT NOT NULL,            -- 参照項目（floor1_area_m2等）
  range_min REAL,                           -- 範囲下限
  range_max REAL,                           -- 範囲上限
  result_quantity REAL NOT NULL,            -- 算出数量
  extra_condition_json TEXT,                -- 追加条件（JSON：{"roof_shape":"kirizuma"}等）
  note TEXT,
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,

  FOREIGN KEY (item_id) REFERENCES cost_master_items(id)
);

CREATE INDEX idx_qty_rules_item ON quantity_rule_tables(item_id);
```

### 6. lineup_packages（ラインナップ別パッケージ）

```sql
CREATE TABLE IF NOT EXISTS lineup_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,             -- 工種ID
  lineup TEXT NOT NULL,                     -- ラインナップ
  package_name TEXT NOT NULL,               -- パッケージ名
  price_type TEXT NOT NULL,                 -- fixed / per_tsubo
  price_amount REAL NOT NULL,               -- 金額 or 坪単価
  included_items_json TEXT,                 -- 含まれる項目のJSON
  note TEXT,
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,

  FOREIGN KEY (category_id) REFERENCES cost_categories(id)
);

CREATE INDEX idx_lineup_pkg_category ON lineup_packages(category_id);
CREATE INDEX idx_lineup_pkg_lineup ON lineup_packages(lineup);
```

**例：**

| category | lineup | package_name | price_type | price_amount |
|---------|--------|-------------|-----------|-------------|
| carpentry | MOKU_OOYANE | 木工事MOKU大屋根 | fixed | 2100000 |
| carpentry | MOKU_HIRAYA | 木工事MOKU平屋 | fixed | 2200000 |
| carpentry | MOKU_ROKU | 木工事MOKU ROKU | fixed | 1600000 |
| lighting_equipment | MOKU_OOYANE | 照明MOKU大屋根 | fixed | 250000 |
| lighting_equipment | RIN | 照明RIN | per_tsubo | 10000 |
| housing_equipment | MOKU_* | 水まわりクリナップ | fixed | 853000 |
| housing_equipment | SHIN | 水まわりタカラ | fixed | 1061000 |

### 7. product_catalog（商品カタログ）

サッシ・内装建具・畳・太陽光・蓄電池など、商品選択型の工種用。

```sql
CREATE TABLE IF NOT EXISTS product_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,             -- 工種ID
  product_code TEXT UNIQUE NOT NULL,
  product_name TEXT NOT NULL,               -- 商品名
  manufacturer TEXT,                        -- メーカー
  series TEXT,                              -- シリーズ
  size_spec TEXT,                           -- サイズ・仕様
  unit TEXT,                                -- 単位
  unit_price REAL NOT NULL,                 -- 単価
  is_standard INTEGER DEFAULT 0,            -- 標準仕様か
  standard_for_lineup TEXT,                 -- 標準仕様の対象ラインナップ
  note TEXT,
  price_source TEXT,                        -- 単価根拠
  price_source_date TEXT,                   -- 見積日
  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,

  FOREIGN KEY (category_id) REFERENCES cost_categories(id)
);

CREATE INDEX idx_product_category ON product_catalog(category_id);
CREATE INDEX idx_product_standard ON product_catalog(is_standard);
```

### 8. area_rules（地域・自治体ルール）

```sql
CREATE TABLE IF NOT EXISTS area_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL,                  -- plumbing_subsidy / septic_surcharge / cleaning_area / waste_area
  prefecture TEXT,
  city TEXT,
  municipality_code TEXT,

  -- 各種金額・条件
  amount REAL,                              -- 金額（加入分担金、加算額等）
  note TEXT,                                -- 備考
  requires_confirmation INTEGER DEFAULT 0,  -- 要確認
  reference_url TEXT,                       -- 参照URL（自治体HP等）

  is_active INTEGER DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_area_rules_type ON area_rules(rule_type);
CREATE INDEX idx_area_rules_city ON area_rules(city);
```

### 9. project_cost_items（案件別採用明細）

```sql
CREATE TABLE IF NOT EXISTS project_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  master_item_id INTEGER,                   -- NULLの場合は手動追加明細
  product_catalog_id INTEGER,               -- 商品カタログからの場合

  -- 項目情報（マスタからスナップショット）
  item_name TEXT NOT NULL,
  unit TEXT,

  -- 採用状態
  is_selected INTEGER DEFAULT 1,            -- 採用/非採用
  selection_reason TEXT,                     -- 採用/非採用の理由

  -- 自動計算値
  auto_quantity REAL,
  auto_unit_price REAL,
  auto_amount REAL,

  -- 手修正値
  manual_quantity REAL,
  manual_unit_price REAL,
  manual_amount REAL,
  override_reason TEXT,                     -- 手修正理由（手修正がある場合は必須）

  -- 最終確定値
  final_quantity REAL,
  final_unit_price REAL,
  final_amount REAL DEFAULT 0,

  -- メタ情報
  vendor_name TEXT,                         -- 発注先
  calculation_basis TEXT,                   -- 算出根拠
  note TEXT,                                -- 備考
  warning_text TEXT,                        -- 警告メッセージ

  -- 確認ステータス
  review_status TEXT DEFAULT 'pending',     -- pending / confirmed / needs_review / flagged
  reviewed_by INTEGER,
  reviewed_at TEXT,

  -- 添付
  evidence_file_key TEXT,                   -- R2のファイルキー

  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (category_id) REFERENCES cost_categories(id),
  FOREIGN KEY (master_item_id) REFERENCES cost_master_items(id),
  FOREIGN KEY (product_catalog_id) REFERENCES product_catalog(id)
);

CREATE INDEX idx_pci_project ON project_cost_items(project_id);
CREATE INDEX idx_pci_category ON project_cost_items(project_id, category_id);
CREATE INDEX idx_pci_review ON project_cost_items(review_status);
```

### 10. project_cost_summaries（案件別工種集計）

```sql
CREATE TABLE IF NOT EXISTS project_cost_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,

  auto_total_amount REAL DEFAULT 0,         -- 自動計算合計
  manual_adjustment_amount REAL DEFAULT 0,  -- 手修正差額
  final_total_amount REAL DEFAULT 0,        -- 最終合計

  review_status TEXT DEFAULT 'pending',     -- pending / confirmed / needs_review
  review_comment TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,

  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (category_id) REFERENCES cost_categories(id),
  UNIQUE(project_id, category_id)
);

CREATE INDEX idx_pcs_project ON project_cost_summaries(project_id);
```

### 11. project_warnings（案件別警告）

```sql
CREATE TABLE IF NOT EXISTS project_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category_id INTEGER,                      -- 特定工種に紐づく場合
  item_id INTEGER,                          -- 特定明細に紐づく場合

  warning_type TEXT NOT NULL,               -- missing_input / condition_unmet / threshold_exceeded
                                            -- area_surcharge / manual_required / cross_category
  severity TEXT DEFAULT 'warning',          -- info / warning / error
  message TEXT NOT NULL,                    -- 警告メッセージ
  recommendation TEXT,                      -- 推奨アクション
  is_resolved INTEGER DEFAULT 0,            -- 解決済み
  resolved_by INTEGER,
  resolved_at TEXT,
  resolved_note TEXT,

  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_pw_project ON project_warnings(project_id);
CREATE INDEX idx_pw_unresolved ON project_warnings(project_id, is_resolved);
```

### 12. master_change_logs（マスタ変更履歴）

```sql
CREATE TABLE IF NOT EXISTS master_change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_table TEXT NOT NULL,               -- cost_master_items / cost_rule_conditions / product_catalog等
  target_id INTEGER NOT NULL,
  change_type TEXT NOT NULL,                -- create / update / deactivate / price_change / rule_change
  field_name TEXT,                          -- 変更対象フィールド
  before_value TEXT,                        -- 変更前値
  after_value TEXT,                         -- 変更後値
  reason TEXT,                              -- 変更理由
  changed_by INTEGER,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_mcl_target ON master_change_logs(target_table, target_id);
CREATE INDEX idx_mcl_date ON master_change_logs(changed_at);
```

### 13. project_audit_logs（案件変更履歴）

```sql
CREATE TABLE IF NOT EXISTS project_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,                -- project / cost_item / cost_summary
  target_id INTEGER,
  action TEXT NOT NULL,                     -- create / update / recalculate / review / override
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
```

### 14. users（ユーザー）

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'estimator',            -- admin / manager / estimator / viewer
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 15. project_phase_estimates（見積フェーズ管理）

将来的に商談概算〜実行予算まで対応するための拡張テーブル。

```sql
CREATE TABLE IF NOT EXISTS project_phase_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  phase_type TEXT NOT NULL,                 -- consultation_rough / internal_estimate / contract_estimate / execution_budget
  phase_name TEXT,
  total_cost REAL,                          -- 原価合計
  total_price REAL,                         -- 売価合計
  gross_margin_rate REAL,                   -- 粗利率
  snapshot_json TEXT,                       -- フェーズ時点のスナップショット（JSON）
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_ppe_project ON project_phase_estimates(project_id);
```

---

## ER図（論理）

```
projects 1---* project_cost_items *---1 cost_master_items *---1 cost_categories
    |                |                        |
    |                |                   cost_rule_conditions
    |                |                   quantity_rule_tables
    |                |
    +---* project_cost_summaries *---1 cost_categories
    |
    +---* project_warnings
    |
    +---* project_audit_logs
    |
    +---* project_phase_estimates

cost_categories 1---* lineup_packages
cost_categories 1---* product_catalog
cost_categories 1---* cost_master_items

area_rules（独立参照）
users（独立参照）
master_change_logs（独立参照）
```

---

## 制約・注意事項

### D1固有の制約
1. **JOINは最小限に**：D1はSQLiteベースなので複雑なJOINは避ける
2. **JSONカラムの活用**：柔軟な構造はJSON型で持たせる（extra_condition_json等）
3. **インデックス設計**：検索頻度の高いカラムのみ
4. **トランザクション**：D1はトランザクションサポートあり、案件保存時は活用する

### 単価スナップショットの考え方
- `project_cost_items`の`auto_unit_price`はマスタからコピーした時点値
- マスタ単価が変わっても、既存案件の数字は変わらない
- 再計算を明示的に実行したときだけ最新マスタを反映（`recalculate`アクション）

### 将来の拡張余地
- `project_phase_estimates`で商談概算〜実行予算まで対応可能
- `area_rules`で自治体ルールを段階的に拡充可能
- `product_catalog`でメーカー品番マスタを成長させられる
- OpenAI連携の結果は`project_cost_items`のdraftとして一時保存可能

---

*最終更新: 2026-03-07*
