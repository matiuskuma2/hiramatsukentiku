# 横断クロスレビュー Phase 2 - 統合整合性検証

> **前提**: 07_CROSS_REVIEW_AND_RESOLUTIONS.md の指摘事項(C-01~C-10, T-01~T-08, S-01~S-05, O-01~O-06, U-01~U-06)はv2ドキュメントに反映済み。
> 本ドキュメントはそれらの反映状況を検証し、**新たに発見された矛盾・不足・リスク**を追記する。
> `import_seed_to_d1.ts` スクリプト設計との整合性も確認。

**レビュー対象**: 00~08全ドキュメント(v2版優先) + 4シードJSONファイル + import_seed_to_d1.ts スクリプト仕様

---

## 1. 前回指摘の反映状況検証

### 1-1. v2ドキュメントへの反映完了確認

| 指摘ID | 内容 | 反映先 | 状態 | 確認結果 |
|--------|------|--------|------|---------|
| C-01 | 37工種統一 | 00, 01_v2 | OK | 00_PROJECT_OVERVIEW.md L192「全37工種」、01_v2 37行テーブル確認 |
| C-02 | 12計算方式 | 00, 01_v2, 07 | OK | 00_PROJECT_OVERVIEW.md L72~88に12パターン明記 |
| C-03 | TEXT PK | 01_v2 | OK | cost_categories, cost_master_items, cost_rule_conditions = TEXT PK |
| C-04 | cost_master_item_versions新設 | 01_v2 | OK | CREATE TABLE文あり、FK/インデックス完備 |
| C-05 | per_piece追加 | 00, 07 | OK | 12パターン表に含まれる |
| C-06 | base_fixed_amount追加 | 01_v2 | OK | cost_master_items に base_fixed_amount REAL あり |
| C-07 | JSON構造ルール | 01_v2 | OK | conditions_json TEXT, actions_json TEXT |
| C-08 | gross_margin_group統一 | 01_v2 | OK | cost_categories.gross_margin_group |
| C-09 | roof統一 | 01_v2 | OK | cat_roof / roof で統一 |
| C-10 | 瑕疵担保金額確定 | シード | OK | seed_items に全面積帯の金額あり |
| T-01 | final_*ロジック | 01_v2 | OK | L579~609にCASE文で明文化 |
| T-02 | 手修正保持ルール | 01_v2 | OK | L612~620のテーブルで定義 |
| T-07 | calculation_basis_note統一 | 01_v2 | OK | カラム名統一済み |
| T-08 | source_*カラム追加 | 01_v2 | OK | 4カラム追加済み |
| S-03 | section_type→item_group | 01_v2 | **部分的** | 後述（NEW-01） |
| S-04 | ai_check_target追加 | 01_v2 | OK | INTEGER DEFAULT 1 |
| S-05 | display_order追加 | 01_v2 | OK | INTEGER DEFAULT 0 |
| O-02 | 楽観ロック | 01_v2 | OK | projects, project_cost_items, project_cost_summaries に version カラム |

---

## 2. 新規発見の矛盾・不整合

### NEW-01: 【Critical】 lineup値の不一致（DB定義 vs シードルール）

| 箇所 | 値 |
|------|-----|
| 01_v2 projects.lineup コメント | `SHIN / RIN / MOKU_OOYANE / MOKU_HIRAYA / MOKU_ROKU` |
| 02 木工事定義 | `MOKU_OOYANE / MOKU_HIRAYA / MOKU_ROKU` |
| seed_items item_name | `MOKU OOYANE / MOKU HIRAYA / MOKU ROKU`（スペース区切り） |
| seed_rules conditions.value | `"MOKU OOYANE"` / `"MOKU HIRAYA"` / `"MOKU ROKU"`（スペース区切り） |

**問題**: DBコメントとドキュメントは `MOKU_OOYANE`（アンダースコア）だが、シードファイルのルール条件は `"MOKU OOYANE"`（スペース）。ルールエンジンが `lineup` フィールドを評価する際に不一致が発生し、**木工事MOKU系が一切マッチしなくなる**。

**影響度**: **致命的** - テスト案件3のMOKU_HIRAYAで木工事が全く自動計算されない。

**解決方針**:
- **案A（推奨）**: DB上の `lineup` 値をアンダースコア形式（`MOKU_OOYANE`）に正規化し、シードルールの `conditions.value` もアンダースコア形式に修正する
- **案B**: シードルール側に合わせてスペース形式にする → しかしDB値としてスペースは避けるべき

**対応必須箇所**:
1. `seed_rules_priority_a.json` の4箇所: `"MOKU OOYANE"` → `"MOKU_OOYANE"` 等
2. `seed_items_priority_a.json` の item_name は日本語表示名なので変更不要（DBの `item_name` は表示用）
3. `import_seed_to_d1.ts` に正規化バリデーションを追加

---

### NEW-02: 【Critical】 `item_panel_shipping` のcalculation_type矛盾

| 箇所 | 値 |
|------|-----|
| seed_items | `calculation_type: "fixed_amount"`, `current_unit_price: 30000`, `current_fixed_amount: null` |
| seed_rules rule_panel_shipping | `actions: [set_quantity: 2, set_fixed_amount: 60000]` |

**問題**: 
1. `calculation_type` が `fixed_amount` なのに `current_unit_price` に値が入り `current_fixed_amount` が null → C-06の「fixed_amountならbase_fixed_amountを使用」ルールに違反
2. ルール側で `set_fixed_amount: 60000` を設定しているが、本体の `current_unit_price: 30000` × 数量2 = 60000 と同額 → 実質 `per_piece` 的な使い方をしている

**解決方針**:
- `current_unit_price: 30000` → `current_unit_price: null`, `current_fixed_amount: 60000`（ルール側と整合を取る）
- または、`calculation_type` を `"per_piece"` に変更（数量2 × 30,000/車 = 60,000）
- **推奨**: `fixed_amount` を維持し、`current_unit_price` → null、`current_fixed_amount` → 60000 に修正。ルールの `set_quantity: 2` は不要になるため削除。

---

### NEW-03: 【High】 `item_foundation_small_truck` のcalculation_type矛盾

| 箇所 | 値 |
|------|-----|
| seed_items | `calculation_type: "fixed_amount"`, `current_unit_price: 3500`, `current_fixed_amount: null`, `unit: "m3"` |

**問題**: `fixed_amount` タイプなのに `unit: "m3"` かつ `current_unit_price: 3500` で `current_fixed_amount` がnull。これは実質 `per_piece`（数量 × 3,500/m3）の使い方。C-06の規約違反。

**解決方針**: `calculation_type` を `"manual_quote"` に変更（生コン小型指定は条件付き追加項目で数量未確定）。または `"per_piece"` に変更。

---

### NEW-04: 【High】 `cost_master_item_versions` と `cost_master_items` の金額カラム名不一致

| テーブル | 金額カラム名 |
|---------|-------------|
| cost_master_items | `base_unit_price`, `base_fixed_amount` |
| cost_master_item_versions | `unit_price`, `fixed_amount` |
| seed_items | `current_unit_price`, `current_fixed_amount` |
| seed_item_versions | `unit_price`, `fixed_amount` |

**問題**: 3つの異なるプレフィックス（`base_`, `current_`, なし）が混在。import_seed_to_d1.ts でのマッピングにおいて混乱が生じ、データ投入バグの温床になる。

**解決方針**:
- マッピングルールを明文化（05_v2で部分的に対応済みだが、一貫性のために以下を確定）:
  - `seed_items.current_unit_price` → `cost_master_items.base_unit_price`
  - `seed_items.current_fixed_amount` → `cost_master_items.base_fixed_amount`
  - `seed_item_versions.unit_price` → `cost_master_item_versions.unit_price`（そのまま）
  - `seed_item_versions.fixed_amount` → `cost_master_item_versions.fixed_amount`（そのまま）
- `import_seed_to_d1.ts` に明示的マッピング定数を定義

---

### NEW-05: 【High】 02_COST_CALCULATION_DEFINITIONS.md の未更新箇所

| 行 | 内容 | 問題 |
|----|------|------|
| L1 | 「全35工種＋2カテゴリ」 | C-01で37に統一済みなのに旧表現のまま |
| L11 | 計算方式コード一覧 | `per_piece` と `per_meter` が一覧テーブルに無い |
| L21 | 屋根工事 | `roofing` → C-09で `roof` に統一済みなのにセクションタイトル「21. 屋根工事 (roofing)」のまま |
| L24 | 電気設備工事 | `electrical` → `electrical_facility` に統一すべき |
| L394 | 原価サマリー画面 | 「全35工種中」 → 「全37工種中」に修正必要 |
| L194 | 基礎工事参照面積 | `building_area_m2 or total_floor_area_m2` → U-02で`building_area_m2`に確定済みなのに旧表現 |

**解決方針**: 02_COST_CALCULATION_DEFINITIONS.md の一括更新が必要。v2改訂版を作成すべき。

---

### NEW-06: 【High】 03_SCREEN_DESIGN.md の未更新箇所

| 行 | 内容 | 問題 |
|----|------|------|
| L394 | 「全35工種中」 | 37に修正必要 |
| L167 | 粗利率設定 | 太陽光粗利率のみ。オプション粗利率（option_gross_margin_rate）がUIに無い |
| API一覧 | マスタAPI | `cost_master_item_versions` のCRUD APIが未定義 |
| API一覧 | AI条件チェック | 「Phase 2」と記載されているが、06_v2では「Phase 1に含む」 |
| COST_CATEGORY画面 | URL | `/projects/:id/costs/:categoryId` → categoryIdはcategory_code(TEXT)なのでURLパラメータの型が不明確 |

**解決方針**: 03_SCREEN_DESIGN.md のv2改訂版を作成すべき。

---

### NEW-07: 【High】 シードデータのboolean/integer型変換ルールの未定義

| シードフィールド | 値の例 | DB型 | 変換ルール |
|----------------|--------|------|-----------|
| `requires_review` | `true` | `INTEGER` | true→1, false→0 |
| `is_active` | `true` | `INTEGER` | true→1, false→0 |
| `default_selected` | `true/false` | `INTEGER` | true→1, false→0 |
| `ai_check_target` | `true` | `INTEGER` | true→1, false→0 |
| `requires_manual_confirmation` | `true/false` | `INTEGER` | true→1, false→0 |

ルール条件内:
| `has_yakisugi` | `true` | DB: `INTEGER` | ルール条件の `value: true` は DB上 `1` と比較必要 |
| `is_shizuoka_prefecture` | `true/false` | DB: `INTEGER` | 同上 |
| `is_cleaning_area_standard` | `false` | DB: `INTEGER` | 同上 |

**問題**: 
1. `import_seed_to_d1.ts` で JSON の `true/false` を SQLite の `1/0` に変換する処理が必須
2. **ルール評価エンジン**でも `conditions_json` 内の `value: true` と DB上の `INTEGER 1` の比較ロジックが必要
3. `insulation_grade` は文字列 `"5"` / `"6"` で、ルール条件でも `value: "5"` と文字列比較

**解決方針**:
1. `import_seed_to_d1.ts` にboolean→integer変換を必須実装
2. ルール評価エンジンの設計仕様書に「型変換ルール」セクションを追加:
   - `value: true` → `field == 1` として評価
   - `value: false` → `field == 0` として評価
   - `value: "5"` → 文字列比較（`insulation_grade = '5'`）
   - `value: [array]` → `IN` 演算子で配列内いずれかにマッチ

---

### NEW-08: 【Medium】 `defect_insurance` の sort_order 衝突問題（未解決）

| ドキュメント | sort_order |
|-------------|-----------|
| 01_v2 テーブル一覧 L218 | cat_defect_insurance = 310 |
| seed_categories | `sort_order: 300` |
| 05_v2 L136 | 「シードの300を採用。外注監査を295に調整」 |
| 01_v2 テーブル一覧 L217 | cat_external_audit = 300 |

**問題**: 
- 05_v2では「外注監査を295に調整」と書いてあるが、01_v2のテーブル一覧では外注監査が300、瑕疵担保が310のまま
- シードでは瑕疵担保が300 → 01_v2と不一致

**解決方針**: 01_v2のテーブル一覧を修正:
- `cat_external_audit` → sort_order: 295
- `cat_defect_insurance` → sort_order: 300（シードに合わせる）

---

### NEW-09: 【Medium】 seed_quantity_rules.json が未作成だがimportスクリプトが参照

| 箇所 | 状態 |
|------|------|
| import_seed_to_d1.ts 仕様 | `seed_quantity_rules.json` を読み込む |
| uploaded_files | 存在しない |
| 05_v2 投入順序 Step 5 | `quantity_rule_tables` への投入を予定 |

**問題**: インポートスクリプトは `seed_quantity_rules.json` を参照するが、ファイルが存在しない。Step 5の投入が実行できない。

**解決方針**: 
1. Phase 1ではWB部材ルール等の `quantity_rule_tables` は未整備のため、スキップ可能にする
2. `import_seed_to_d1.ts` でファイル不存在時は警告のみ出力してスキップ
3. Priority B/Cのシード作成時に `seed_quantity_rules.json` を作成

---

### NEW-10: 【Medium】 `cost_rule_conditions` に `rule_name` / `valid_from` / `valid_to` がシードにない

| DBカラム | シードに存在 |
|---------|------------|
| `rule_name` | なし |
| `valid_from` | なし |
| `valid_to` | なし |
| `is_active` | なし（暗黙的にtrue） |

**問題**: DB定義にあるカラムがシードJSONに存在しない。`import_seed_to_d1.ts` でデフォルト値の補完が必要。

**解決方針**:
- `rule_name` → `id` と同一値、または null
- `valid_from` → null（無期限有効）
- `valid_to` → null
- `is_active` → 1（デフォルト）

---

### NEW-11: 【Medium】 `cost_master_items.item_code` のUNIQUE制約と投入順序

| カラム | 制約 |
|--------|------|
| `id` | TEXT PRIMARY KEY |
| `item_code` | TEXT UNIQUE NOT NULL |

**問題**: シードの `id` と `item_code` が別の値（例: `id: "item_foundation_lt60"`, `item_code: "foundation_lt60"`）。PKの `id` はプレフィックス `item_` 付き、`item_code` はプレフィックスなし。この命名規則が一貫しているか全49件を検証する必要がある。

**検証結果**: 全49件を確認、`id = "item_" + item_code` の規則で一貫。ただし `import_seed_to_d1.ts` で両方のフィールドが確実に投入されるよう必須チェックが必要。

---

## 3. DB設計の整合性検証

### 3-1. マイグレーションSQL未作成

**状態**: `/home/user/webapp/` 配下にSQLファイル、TypeScriptファイルが0件。マイグレーションファイルは未作成。

**必要なマイグレーションファイル**:
```
migrations/
  0001_initial_schema.sql     -- 全16テーブルのCREATE TABLE + INDEX
```

**01_v2のCREATE TABLE文との整合性**: テーブル12~16（project_warnings, master_change_logs, project_audit_logs, users, project_phase_estimates）は「前版と同一」とされているが、**CREATE TABLE文が01_v2に記載されていない**。01_DB_SCHEMA_DESIGN.md（v1）を参照する必要がある。

**対応**: マイグレーション作成時に01_v1から5テーブルのCREATE文を取得し、v2の変更点を反映する。

---

### 3-2. FK整合性検証

| FK | 親テーブル | 子テーブル | 整合性 |
|----|----------|----------|--------|
| project_cost_items.project_id → projects.id | INTEGER | INTEGER | OK |
| project_cost_items.master_item_id → cost_master_items.id | TEXT | TEXT | OK |
| project_cost_items.master_item_version_id → cost_master_item_versions.id | TEXT | TEXT | OK |
| project_cost_items.product_catalog_id → product_catalog.id | INTEGER | INTEGER | OK |
| cost_master_item_versions.master_item_id → cost_master_items.id | TEXT | TEXT | OK |
| cost_rule_conditions.master_item_id → cost_master_items.id | TEXT | TEXT | OK |
| quantity_rule_tables.master_item_id → cost_master_items.id | TEXT | TEXT | OK |

**注意**: D1(SQLite)ではFK制約はデフォルト無効。`PRAGMA foreign_keys = ON` を実行するか、アプリ層でRIを保証する必要がある。`import_seed_to_d1.ts` の投入順序（categories → items → versions → rules）が正しく守られていればFK違反は発生しない。

---

### 3-3. インデックス設計の検証

**不足しているインデックス**:

| テーブル | 推奨インデックス | 理由 |
|---------|----------------|------|
| project_cost_items | `(project_id, category_code, sort_order)` | 工種詳細画面での一覧表示に必須 |
| cost_master_items | `(category_code, is_active, display_order)` | マスタ一覧のカテゴリ内ソート |
| project_warnings | `(project_id, is_resolved)` | 未解決警告の高速取得 |

**既存だが確認必要**:
- `idx_pci_category` は `(project_id, category_code)` → OK
- `project_warnings` のインデックスは01_v2に記載がない（テーブル定義自体が「前版と同一」扱い）

---

## 4. API設計の整合性検証

### 4-1. 03_SCREEN_DESIGN.md のAPI一覧と06_v2の実装計画の対照

| API | 03設計 | 06_v2 | 整合性 |
|-----|--------|-------|--------|
| POST /api/projects/:id/calculate | あり | Step 4 | OK |
| GET /api/projects/:id/costs | あり | Step 5 | OK |
| GET /api/projects/:id/costs/:categoryId | あり | Step 5 | **型注意**: categoryIdはcategory_code(TEXT) |
| PUT /api/projects/:id/costs/:itemId | あり | Step 5 | OK |
| GET /api/master/items/:id/versions | **なし** | Step 2 | **不足**: version管理APIが03に未定義 |
| POST /api/master/items/:id/versions | **なし** | Step 2 | **不足** |
| POST /api/ai/check-conditions | Phase 2扱い | Phase 1 | **矛盾**: 06_v2ではPhase 1に含むが03ではPhase 2 |
| POST /api/projects/:id/recalculate | **なし** | Step 4 | **不足**: 再計算APIが独立定義されていない |

### 4-2. 不足API定義

以下のAPIが設計ドキュメントに不足:

```
-- バージョン管理API（Step 2で必要）
GET    /api/master/items/:id/versions          -- バージョン一覧
POST   /api/master/items/:id/versions          -- 新バージョン追加
GET    /api/master/items/:id/versions/current   -- 現在有効バージョン

-- 再計算API（Step 4で必要）
POST   /api/projects/:id/recalculate            -- 全工種再計算
POST   /api/projects/:id/recalculate/:categoryCode  -- 個別工種再計算

-- ヘルスチェック（08_OPERATIONAL_RUNBOOK.mdで参照）
GET    /api/health                              -- サービスヘルスチェック

-- マスタ変更通知（O-01対応）
GET    /api/master/changes/recent               -- 直近のマスタ変更一覧
GET    /api/master/changes/:id/affected-projects -- 影響案件一覧

-- シード管理API（import_seed_to_d1.ts から呼ぶ場合）
POST   /api/admin/seed/validate                 -- シードデータ検証
POST   /api/admin/seed/import                   -- シードデータ投入
```

---

## 5. 依存関係・実装順序の検証

### 5-1. import_seed_to_d1.ts の前提条件

import_seed_to_d1.ts が正常動作するために必要な前提:

```
[前提1] D1データベースが作成済み
    ↓
[前提2] マイグレーション(0001_initial_schema.sql)が適用済み
    ↓
[前提3] シードJSONファイルが所定のパスに配置済み
    ↓
[前提4] wrangler.jsonc にD1バインディングが設定済み
    ↓
[実行] import_seed_to_d1.ts
    ↓
[出力A] SQLファイル生成（バックアップ用）
[出力B] D1直接実行（--execute オプション時）
```

### 5-2. 実装順序の矛盾チェック

| 順序 | 06_v2の計画 | 依存関係 | 問題 |
|------|-----------|---------|------|
| Step 1 | 基盤構築 | なし | OK |
| Step 2 | マスタ投入・API | Step 1必須 | OK |
| Step 3 | 案件管理 | Step 1必須 | OK（Step 2と並行可） |
| Step 4 | 計算エンジン | Step 2 + Step 3 必須 | OK |
| Step 5 | 原価画面 | Step 4 必須 | OK |
| Step 6 | サマリー | Step 5 必須 | OK |
| Step 9 | 警告・チェック | Step 4 必須 | **注意**: AI条件チェック(Phase 1)のAPI設計が03で未定義 |

**矛盾なし** ただし Step 2 と Step 3 は並行実行可能。Step 9 のAI条件チェックは03_SCREEN_DESIGN.mdで「Phase 2」扱いだが06_v2ではPhase 1に含む → **03の修正が必要**。

---

## 6. import_seed_to_d1.ts スクリプトへの要求仕様

### 6-1. 必須バリデーション項目

#### Categories バリデーション
- [x] `id` が `cat_` プレフィックスで始まること
- [x] `category_code` が非空であること
- [x] `sort_order` が正の整数であること
- [x] `gross_margin_group` が `standard / solar / option` のいずれかであること
- [ ] **追加**: sort_orderの重複チェック（同一値がないこと）

#### Items バリデーション
- [x] `id` が `item_` プレフィックスで始まること
- [x] `category_code` がcategoriesに存在すること
- [x] `item_code` がユニークであること
- [x] `calculation_type` が12パターンのいずれかであること
- [x] `current_unit_price` と `current_fixed_amount` の整合性チェック
- [ ] **追加**: `source_sheet_name` が非空であること（トレーサビリティ必須）
- [ ] **追加**: `id == "item_" + item_code` の命名規則チェック

#### Calculation_type vs 金額の整合性チェック（詳細）

| calculation_type | unit_price | fixed_amount | 期待 |
|-----------------|-----------|-------------|------|
| `fixed_amount` | null | 非null | → **seed違反あり**: item_panel_shipping, item_foundation_small_truck |
| `per_tsubo` | 非null | null | OK |
| `per_m2` | 非null | null | OK |
| `per_meter` | 非null | null | OK |
| `per_piece` | 非null | null | OK |
| `range_lookup` | 非nullまたはnull | 非nullまたはnull | 面積帯による選択 |
| `lineup_fixed` | null | 非null | OK |
| `rule_lookup` | 非nullまたはnull | null | ルール結果に依存 |
| `manual_quote` | 非nullまたはnull | null | 手入力前提 |
| `product_selection` | - | - | 商品選択に依存 |
| `package_with_delta` | 非null | null | OK（現行シード準拠） |
| `threshold_surcharge` | - | - | しきい値超過分 |

#### Versions バリデーション
- [x] `master_item_id` がitemsに存在すること
- [x] `version_no` が正の整数であること
- [x] `effective_from` が非空であること
- [ ] **追加**: 同一 `master_item_id` 内で `version_no` がユニークであること
- [ ] **追加**: `unit_price` / `fixed_amount` と items側の金額が一致すること（v1では同額のはず）

#### Rules バリデーション
- [x] `master_item_id` がitemsに存在すること
- [x] `conditions` が配列であること
- [x] `actions` が配列であること
- [ ] **追加**: `conditions[].field` がprojectsテーブルのカラム名に存在すること
- [ ] **追加**: `conditions[].operator` が許可演算子セット内であること
- [ ] **追加**: `actions[].type` が許可アクション種別内であること

### 6-2. SQL生成時の注意事項

1. **boolean→integer変換**: `true` → `1`, `false` → `0`
2. **JSON文字列のエスケープ**: `source_raw_json` はJSON.stringify()後にSQLクォートが必要。シングルクォート内のシングルクォートは`''`にエスケープ
3. **NULL処理**: JSONの `null` → SQLの `NULL`（クォートなし）
4. **配列型のJSON変換**: `conditions`(配列) → `conditions_json` = `JSON.stringify(conditions)`
5. **バッチ分割**: D1の100文バッチ制限に対応し、INSERT文を100件ずつに分割
6. **投入順序の保証**: categories → items → versions → rules の順序で生成

---

## 7. 補完が必要な設計定義

### 7-1. ルール評価エンジンの型変換仕様（NEW-07対応）

```typescript
// ルール評価時の型変換ルール
interface TypeConversionRules {
  // 1. boolean値の比較
  //    ルール側: value: true/false
  //    DB側: INTEGER 1/0
  //    → value === true → field == 1, value === false → field == 0
  
  // 2. 文字列値の比較
  //    ルール側: value: "5"
  //    DB側: TEXT "5"
  //    → 文字列として比較（insulation_grade, lineup等）
  
  // 3. 数値の比較
  //    ルール側: value: 60
  //    DB側: REAL or INTEGER
  //    → 数値として比較（building_area_m2, tsubo等）
  
  // 4. 配列値の比較（in演算子）
  //    ルール側: value: ["SHIN", "RIN"]
  //    → field IN ("SHIN", "RIN")
}
```

### 7-2. 計算エンジンの `package_with_delta` 処理仕様（未定義）

**問題**: 産廃ボックス7アイテムはすべて `package_with_delta` だが、「パッケージ」の定義と「差額」の計算方法が不明確。

**現行シードの構造**:
- 県内セット: 4アイテム（mix_4m3 × 3杯, mix_2m3 × 1杯, board_2m3 × 1杯, manifest × 5部）
- 県外セット: 3アイテム（mix_3_5m3 × 4杯, mix_2m3 × 1杯, board_2m3 × 1杯）

**補完仕様**:
1. `is_shizuoka_prefecture` で県内/県外セットを排他選択（ルールで実装済み）
2. 各アイテムの `current_unit_price × set_quantity` = パッケージ金額
3. 「差額」＝ 数量変更時の追加/減少分
4. UI: 標準数量を表示し、変更があれば差額を自動計算
5. `package_with_delta` の金額計算: `final_amount = unit_price × final_quantity`

### 7-3. 02_COST_CALCULATION_DEFINITIONS.md v2更新項目

以下の更新が必要:
1. タイトルの「全35工種＋2カテゴリ」→「全37工種」
2. 計算方式コード一覧に `per_piece`, `per_meter` を追加
3. `roofing` → `roof` のカテゴリコード修正
4. `electrical` → `electrical_facility` のカテゴリコード修正
5. 基礎工事の参照面積を `building_area_m2` に確定
6. 瑕疵担保保険の「要確認」金額をシード確定値に更新

---

## 8. チェックリスト: 実装着手前の必須対応

### 即座に対応（ブロッカー）

| # | 対応 | 関連Issue | 担当 |
|---|------|----------|------|
| 1 | **lineup値をアンダースコア形式に統一** | NEW-01 | シード修正 |
| 2 | **item_panel_shipping の金額フィールド修正** | NEW-02 | シード修正 |
| 3 | **item_foundation_small_truck のcalculation_type修正** | NEW-03 | シード修正 |
| 4 | **マイグレーションSQL作成**（全16テーブル） | 3-1 | 実装 |
| 5 | **01_v2のsort_order衝突を解消** | NEW-08 | ドキュメント修正 |

### 実装初期に対応

| # | 対応 | 関連Issue | 担当 |
|---|------|----------|------|
| 6 | import_seed_to_d1.ts にboolean→integer変換実装 | NEW-07 | スクリプト |
| 7 | import_seed_to_d1.ts に金額カラム名マッピング実装 | NEW-04 | スクリプト |
| 8 | 02_COST_CALCULATION_DEFINITIONS.md v2作成 | NEW-05 | ドキュメント |
| 9 | 03_SCREEN_DESIGN.md v2作成（バージョンAPI追加等） | NEW-06 | ドキュメント |
| 10 | ルール評価エンジンの型変換仕様策定 | NEW-07 | 設計 |
| 11 | package_with_delta の処理仕様確定 | 7-2 | 設計 |
| 12 | seed_quantity_rules.json のスキップ対応 | NEW-09 | スクリプト |
| 13 | cost_rule_conditions のデフォルト値補完ロジック | NEW-10 | スクリプト |

### ドキュメント更新

| # | ドキュメント | 更新内容 |
|---|------------|---------|
| 14 | 01_v2 sort_order修正 | external_audit: 295, defect_insurance: 300 |
| 15 | 01_v2 テーブル12~16のCREATE文追記 | 前版からコピー＋v2修正 |
| 16 | 02 v2作成 | 37工種統一、12計算方式、コード統一、金額確定 |
| 17 | 03 v2作成 | 37工種、オプション粗利率、バージョンAPI、AI Phase1 |
| 18 | 05_v2 sort_order修正 | external_audit: 295 |

---

## 9. テスト案件シミュレーション補足

### 05_v2 のテスト案件3パターンに追加すべき検証ポイント

#### テスト1: SHIN / 35坪 / 等級5 / 県内
- [x] 基礎: building_area_m2=72.5 → 60-90帯 → 25,000/m2
- [x] 木工事: SHIN+35坪 → 大工人工55日 × 50,000 = 2,750,000
- [x] 木工事: SHIN+35坪 → 建方 ≥35坪 → 400,000
- [x] 断熱: 等級5 → eq5_roof_100 + eq5_floor_80
- [x] パネル: 等級5 → eq5_outer (9,000/m2)
- [x] 電気: 29,000/坪 × 35坪 = 1,015,000
- [x] 屋根: 4,500/m2 × roof_area_m2
- [x] 産廃: 県内 → 4アイテム選択
- [x] 瑕疵: total_floor_area_m2=115.5 → 100-125帯
- **追加**: lineup値が`SHIN`でシードルールが`"SHIN"`とマッチすることを確認

#### テスト4（追加推奨）: MOKU_OOYANE / 30坪 / 等級6 / 県外
- lineup値が`MOKU_OOYANE`でルール条件の値と一致すること（**NEW-01修正後**）
- 木工事: MOKU_OOYANE → 2,100,000固定
- 断熱: 等級6 → eq6系4アイテム
- 産廃: 県外 → 3アイテム選択
- 焼杉なし → item_carpentry_yakisugi 非選択

---

## 10. 結論

### v2ドキュメント群の整合性評価

**全体評価: 85%整合**（前回の60%から大幅改善）

| カテゴリ | 整合度 | 主要課題 |
|---------|--------|---------|
| DB設計 (01_v2) | 90% | sort_order衝突、テーブル12~16未記載 |
| 計算定義 (02) | 70% | v2未作成、旧表現が残存 |
| 画面・API (03) | 75% | v2未作成、バージョンAPI不足、Phase区分矛盾 |
| OpenAI (04) | 95% | 問題なし |
| マスタ計画 (05_v2) | 90% | sort_order衝突のみ |
| 実装計画 (06_v2) | 95% | 問題なし |
| クロスレビュー (07) | 100% | 解決方針は全て適切 |
| 運用ランブック (08) | 90% | project_warnings テーブルのCREATE文参照 |
| シードJSON | 80% | lineup値不一致、金額フィールド矛盾 |

### 最優先対応3項目

1. **lineup値のアンダースコア統一（NEW-01）** → 計算エンジンの正常動作に直結
2. **シードデータの金額フィールド修正（NEW-02, NEW-03）** → import_seed_to_d1.ts のバリデーション通過に必須
3. **マイグレーションSQL作成** → 全実装の前提条件

---

*最終更新: 2026-03-07*
*レビュー実施者: 統合設計レビューPhase 2*
*対象ドキュメント: 00~08 (v2版優先) + 4シードJSON + import_seed_to_d1.ts仕様*
