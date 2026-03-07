# マスタデータ初期投入計画 v2（改訂版）

> **改訂履歴**: 07_CROSS_REVIEW_AND_RESOLUTIONS.md の指摘事項を反映。シードJSONファイルとの整合性を確認・統一。

## 概要

現行スプレッドシートの全データをシステムのマスタテーブルに移行する計画。
マスタデータの品質がシステムの精度を決めるため、慎重に進める。

**シードファイル体系**: JSONファイルをPriority（A/B/C）で分割管理する。

---

## シードファイルとDBスキーマの対照表

### ファイル一覧と対応テーブル

| シードファイル | 対応テーブル | 状態 |
|--------------|-------------|------|
| seed_categories_priority_a.json | cost_categories | Priority A: 10工種（全37中） |
| seed_items_priority_a.json | cost_master_items | Priority A: 49アイテム |
| seed_item_versions_priority_a.json | cost_master_item_versions（**新設**） | Priority A: 49バージョン |
| seed_rules_priority_a.json | cost_rule_conditions | Priority A: 54ルール |
| (未作成) seed_categories_priority_b.json | cost_categories | Priority B/C: 残27工種 |
| (未作成) seed_items_priority_b.json | cost_master_items | Priority B: 約60アイテム |
| (未作成) seed_items_priority_c.json | cost_master_items | Priority C: 約30アイテム |

### フィールドマッピング: seed_categories → cost_categories

| シードフィールド | DBカラム | マッピング |
|----------------|---------|-----------|
| `id` | `id` (TEXT PK) | そのまま使用: `cat_foundation` |
| `category_code` | `category_code` | そのまま使用: `foundation` |
| `category_name` | `category_name` | そのまま使用: `基礎工事` |
| `sort_order` | `sort_order` | そのまま使用 |
| `requires_review` | `requires_review` | `true` → `1` |
| `gross_margin_group` | `gross_margin_group` | そのまま使用（**名前統一済み**） |
| `is_active` | `is_active` | `true` → `1` |

### フィールドマッピング: seed_items → cost_master_items

| シードフィールド | DBカラム | マッピング |
|----------------|---------|-----------|
| `id` | `id` (TEXT PK) | そのまま使用: `item_foundation_lt60` |
| `category_code` | `category_code` | そのまま使用 |
| `item_code` | `item_code` | そのまま使用 |
| `item_name` | `item_name` | そのまま使用 |
| `section_type` | `item_group` / `section_type` | 両方に格納（`basic`/`extra`） |
| `unit` | `unit` | そのまま使用 |
| `calculation_type` | `calculation_type` | そのまま使用（**12パターン対応済み**） |
| `current_unit_price` | `base_unit_price` | そのまま使用（null許容） |
| `current_fixed_amount` | `base_fixed_amount` | そのまま使用（**新設カラム**） |
| `quantity_reference_field` | `quantity_reference_field` | そのまま使用 |
| `vendor_name` | `vendor_name` | そのまま使用 |
| `note` | `note` | そのまま使用 |
| `calculation_basis_note` | `calculation_basis_note` | そのまま使用（**名前統一済み**） |
| `default_selected` | `default_selected` | `true/false` → `1/0` |
| `requires_manual_confirmation` | `requires_manual_confirmation` | `true/false` → `1/0` |
| `ai_check_target` | `ai_check_target` | **新設カラム**: `true` → `1` |
| `display_order` | `display_order` | **新設カラム**: そのまま使用 |
| `is_active` | `is_active` | `true` → `1` |
| `source_sheet_name` | `source_sheet_name` | **新設カラム**: そのまま使用 |
| `source_file_name` | `source_file_name` | **新設カラム**: そのまま使用 |
| `source_row_no` | `source_row_no` | **新設カラム**: そのまま使用 |
| `source_raw_json` | `source_raw_json` | **新設カラム**: JSON文字列化 |

### フィールドマッピング: seed_item_versions → cost_master_item_versions

| シードフィールド | DBカラム | マッピング |
|----------------|---------|-----------|
| `id` | `id` (TEXT PK) | そのまま使用: `ver_item_foundation_lt60_v1` |
| `master_item_id` | `master_item_id` | そのまま使用 |
| `version_no` | `version_no` | そのまま使用 |
| `unit_price` | `unit_price` | そのまま使用 |
| `fixed_amount` | `fixed_amount` | そのまま使用 |
| `effective_from` | `effective_from` | そのまま使用 |
| `effective_to` | `effective_to` | null = 現在有効 |
| `change_reason` | `change_reason` | そのまま使用 |
| `changed_by` | `changed_by` | そのまま使用: `system_seed` |
| `rule_json` | `rule_json` | そのまま使用（空オブジェクト `{}` 許容） |

### フィールドマッピング: seed_rules → cost_rule_conditions

| シードフィールド | DBカラム | マッピング |
|----------------|---------|-----------|
| `id` | `id` (TEXT PK) | そのまま使用: `rule_foundation_lt60` |
| `master_item_id` | `master_item_id` | そのまま使用 |
| `rule_group` | `rule_group` | そのまま使用 |
| `priority` | `priority` | そのまま使用 |
| `conditions` | `conditions_json` | JSON.stringify() |
| `actions` | `actions_json` | JSON.stringify() |

---

## 投入順序

依存関係を考慮し、以下の順序で投入する。

```
Step 1: cost_categories（工種マスタ）37工種
    ↓
Step 2: cost_master_items（明細マスタ）
    ↓
Step 3: cost_master_item_versions（バージョン管理）← NEW
    ↓
Step 4: cost_rule_conditions（条件ルール）
    ↓
Step 5: quantity_rule_tables（数量算出ルール）
    ↓
Step 6: product_catalog（商品カタログ）
    ↓
Step 7: area_rules（地域ルール）
```

> **Note**: `lineup_packages` はPhase 2用予約のため、Phase 1ではシードしない。

---

## Priority A シードファイルの検証結果

### Categories（10/37工種）

| id | category_code | sort_order | 検証結果 |
|----|--------------|-----------|---------|
| cat_foundation | foundation | 80 | OK |
| cat_carpentry | carpentry | 330 | OK |
| cat_insulation | insulation | 100 | OK |
| cat_shinkabe_panel | shinkabe_panel | 110 | OK |
| cat_electrical_facility | electrical_facility | 240 | OK（旧 `electrical` から変更） |
| cat_roof | roof | 210 | OK（旧 `roofing` から変更） |
| cat_site_management | site_management | 350 | OK |
| cat_defect_insurance | defect_insurance | 300 | OK（旧310→300に要注意） |
| cat_cleaning | cleaning | 280 | OK |
| cat_waste_box | waste_box | 290 | OK（旧 `waste_disposal` から変更） |

**注意**: `defect_insurance` の `sort_order` がドキュメント（310）とシード（300）で異なる。シードの300を採用するか、ドキュメントの310に修正するか要確認。→ **シードの300を採用**（外注監査300の後にすると衝突するため、外注監査を295に調整）。

### Items（49アイテム）- カテゴリ別内訳

| カテゴリ | アイテム数 | calculation_type 分布 |
|---------|----------|---------------------|
| foundation | 7 | range_lookup(3), per_meter(1), manual_quote(2), fixed_amount(1) |
| carpentry | 7 | lineup_fixed(3), rule_lookup(2), per_m2(1), range_lookup(0) |
| insulation | 5 | rule_lookup(5) |
| shinkabe_panel | 4 | rule_lookup(2), per_tsubo(1), fixed_amount(1) |
| electrical_facility | 6 | per_tsubo(2), fixed_amount(3), per_piece(1) |
| roof | 7 | per_m2(1), manual_quote(2), per_meter(3), manual_quote(1) |
| site_management | 1 | per_tsubo(1) |
| defect_insurance | 9 | fixed_amount(1), range_lookup(8) |
| cleaning | 6 | per_m2(4), fixed_amount(1), per_piece(1) |
| waste_box | 7 | package_with_delta(7) |

### Rules（54ルール）- 検証項目

| 検証項目 | 結果 | 詳細 |
|---------|------|------|
| master_item_id の参照整合性 | OK | 全ルールのmaster_item_idがseed_itemsに存在 |
| conditions フィールドの参照先 | **要注意** | `has_yakisugi`, `is_shizuoka_prefecture`, `is_cleaning_area_standard` はprojectsテーブルに追加済み（v2スキーマ） |
| priority 衝突 | OK | 同一item内で排他条件のルールは同一priority(100)。70坪以上のみpriority 110で手動確認フラグ |
| actions の型一貫性 | OK | `select`, `set_quantity`, `set_fixed_amount`, `set_reference_field`, `flag_manual_confirmation` が使用 |
| 空conditions | OK | 無条件適用ルール（`rule_panel_partition` 等）は `conditions: []` |

---

## スプレッドシート5フィールドの保持確認

### 全49アイテムの確認結果

| フィールド | 保持率 | 備考 |
|-----------|--------|------|
| 項目名 (`item_name`) | 49/49 (100%) | 全件に値あり |
| 現行金額 (`current_unit_price` / `current_fixed_amount`) | 49/49 (100%) | 排他的に設定（一方がnull） |
| 備考 (`note`) | 17/49 (35%) | 元シートにも備考なしの項目が多い |
| 発注先 (`vendor_name`) | 38/49 (78%) | 一部「未設定」、一部null |
| 算出根拠 (`calculation_basis_note`) | 49/49 (100%) | 全件に値あり |

**結論**: スプレッドシートフィールドは完全に保持されている。`source_raw_json` で元データの生値も保存されており、トレーサビリティは万全。

---

## 残り27工種のシード作成計画

### Priority B（半自動、10工種）

| # | category_code | category_name | 見込みアイテム数 | 見込みルール数 |
|---|--------------|--------------|----------------|--------------|
| 1 | plumbing | 水道工事 | 8〜10 | 5〜8 |
| 2 | housing_equipment | 住宅設備 | 5〜8 | 3〜5 |
| 3 | wb_parts | WB部材 | 3〜5 | 10〜15 |
| 4 | lighting_equipment | 照明・電気設備機器 | 4〜6 | 3〜5 |
| 5 | exterior_wall | 外壁工事 | 6〜8 | 2〜4 |
| 6 | plastering | 左官工事 | 8〜10 | 2〜3 |
| 7 | solar | 太陽光工事 | 10〜12 | 1〜2 |
| 8 | options | オプション | 4〜6 | 1〜2 |
| 9 | tatami | 畳工事 | 6〜8 | 1〜2 |
| 10 | interior_finish | 内装仕上工事 | 4〜6 | 1〜2 |

### Priority C（図面依存、5工種）

| # | category_code | category_name | 見込みアイテム数 |
|---|--------------|--------------|----------------|
| 1 | sash | サッシ・鋼製建具 | 10〜20（商品カタログ） |
| 2 | interior_doors | 内装建具 | 8〜15（商品カタログ） |
| 3 | furniture | 家具製造 | 6〜10 |
| 4 | tile_stone | タイル・石工事 | 5〜8 |
| 5 | earthwork | 土工事 | 3〜5 |

### Priority A の残り（ルール明確だがシード未作成、12工種）

| # | category_code | category_name | 見込みアイテム数 |
|---|--------------|--------------|----------------|
| 1 | site_survey | 外部敷地調査 | 1〜2 |
| 2 | design | 設計業務 | 5〜7 |
| 3 | ground_survey | 地盤調査 | 2〜3 |
| 4 | temporary | 仮設工事 | 10〜12 |
| 5 | scaffolding | 足場工事 | **要確認（詳細シート未提出）** |
| 6 | termite | 防蟻工事 | 2〜3 |
| 7 | precut | プレカット | 3〜4 |
| 8 | building_materials | 建材・副資材 | **要確認（詳細シート未提出）** |
| 9 | hardware | 金物 | 1 |
| 10 | crane | レッカー | 1 |
| 11 | external_audit | 外注監査 | 1〜2 |
| 12 | septic_tank | 浄化槽工事 | 3〜5 |

---

## 投入後の検証方法（改訂版）

### 検証1：工種数の確認
```sql
SELECT COUNT(*) FROM cost_categories WHERE is_active = 1;
-- 期待値: 37
```

### 検証2：明細数の確認
```sql
SELECT cc.category_name, COUNT(cmi.id) as item_count
FROM cost_categories cc
LEFT JOIN cost_master_items cmi ON cc.category_code = cmi.category_code
GROUP BY cc.id
ORDER BY cc.sort_order;
```

### 検証3：バージョンの1対1整合性
```sql
-- 全ての明細にバージョンが1つ以上あること
SELECT cmi.id, COUNT(cmiv.id) as version_count
FROM cost_master_items cmi
LEFT JOIN cost_master_item_versions cmiv ON cmi.id = cmiv.master_item_id
GROUP BY cmi.id
HAVING version_count = 0;
-- 期待値: 0件（全明細にバージョンがある）
```

### 検証4：ルールの参照整合性
```sql
-- 全ルールのmaster_item_idが明細マスタに存在すること
SELECT crc.id, crc.master_item_id
FROM cost_rule_conditions crc
LEFT JOIN cost_master_items cmi ON crc.master_item_id = cmi.id
WHERE cmi.id IS NULL;
-- 期待値: 0件
```

### 検証5：テスト案件でのシミュレーション

| テスト案件 | ラインナップ | 坪数 | 断熱等級 | 県内/外 | 検証ポイント |
|-----------|-------------|------|---------|--------|------------|
| テスト1 | SHIN | 35 | 5 | 県内 | 標準的な2階建て。全Priority A工種が正しく計算されること |
| テスト2 | RIN | 42 | 6 | 県内 | RIN加算(+50,000)、等級6切替（断熱材・パネル単価変更） |
| テスト3 | MOKU_HIRAYA | 28 | 5 | 県外 | MOKU固定額、県外産廃セット切替 |

### 検証6：ルール発火テスト

| ルール | 入力条件 | 期待結果 |
|--------|---------|---------|
| 基礎面積帯 | building_area_m2=72.5 | item_foundation_60_90 が選択される |
| 基礎面積帯 | building_area_m2=55 | item_foundation_lt60 が選択される |
| MOKU自動選択 | lineup=MOKU_OOYANE | item_carpentry_moku_oyane が選択される |
| SHIN大工人工 | lineup=SHIN, tsubo=35 | quantity=55 が設定される |
| SHIN建方加算 | lineup=SHIN, tsubo=35 | fixed_amount=400,000 が設定される |
| RIN電気加算 | lineup=RIN | item_elec_rin_extra が選択される |
| 断熱等級6 | insulation_grade=6 | eq6系アイテム4件が選択される |
| 県内産廃 | is_shizuoka_prefecture=true | 県内セット4アイテムが選択される |
| 県外産廃 | is_shizuoka_prefecture=false | 県外セット3アイテムが選択される |
| 瑕疵担保 | total_floor_area_m2=115 | 100-125帯の保険・検査が選択される |
| 美装エリア外 | is_cleaning_area_standard=false | clean_area_extra が選択される |

---

## 運用ルール（改訂版）

### 単価変更時の手順

1. `cost_master_item_versions` に新バージョンを追加（`effective_from` を設定）
2. 旧バージョンの `effective_to` を設定
3. `cost_master_items` の `base_unit_price` / `base_fixed_amount` を新値に更新
4. `master_change_logs` に変更理由を記録
5. 影響案件を自動検索し、ダッシュボードに通知表示
6. 各案件の担当者が「最新マスタで再計算」を選択するかどうかを判断

### 工種追加時の手順

1. `cost_categories` にレコード追加
2. 対応する明細を `cost_master_items` に追加
3. 初期バージョンを `cost_master_item_versions` に追加
4. 条件ルールが必要なら `cost_rule_conditions` に追加
5. 全シードファイルを更新（Gitで管理）

---

*最終更新: 2026-03-07*
*改訂番号: v2（07_CROSS_REVIEW反映）*
