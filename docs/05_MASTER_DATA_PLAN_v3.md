# マスタデータ初期投入計画 v3（第3版）

> **改訂履歴**:
> - v1: 初版作成
> - v2: 07_CROSS_REVIEW_AND_RESOLUTIONS.md 反映。シードJSONファイルとの整合性確認。
> - v3: 09_CROSS_REVIEW_PHASE2.md 反映。sort_order衝突解消（NEW-08）、シードデータ修正方針（NEW-01〜03）明記、import_seed_to_d1.ts の詳細バリデーション仕様（NEW-07,10,11）追記、テスト案件4追加。

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
| seed_item_versions_priority_a.json | cost_master_item_versions | Priority A: 49バージョン |
| seed_rules_priority_a.json | cost_rule_conditions | Priority A: 54ルール |
| (未作成) seed_quantity_rules.json | quantity_rule_tables | **Phase 1ではスキップ可** |
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
| `requires_review` | `requires_review` | `true` → `1`, `false` → `0` |
| `gross_margin_group` | `gross_margin_group` | そのまま使用 |
| `is_active` | `is_active` | `true` → `1`, `false` → `0` |

### フィールドマッピング: seed_items → cost_master_items

| シードフィールド | DBカラム | マッピング |
|----------------|---------|-----------|
| `id` | `id` (TEXT PK) | そのまま使用: `item_foundation_lt60` |
| `category_code` | `category_code` | そのまま使用 |
| `item_code` | `item_code` | そのまま使用 |
| `item_name` | `item_name` | そのまま使用 |
| `section_type` | `item_group` / `section_type` | 両方に格納（`basic`/`extra`） |
| `unit` | `unit` | そのまま使用 |
| `calculation_type` | `calculation_type` | そのまま使用 |
| **`current_unit_price`** | **`base_unit_price`** | **名前変更** (NEW-04) |
| **`current_fixed_amount`** | **`base_fixed_amount`** | **名前変更** (NEW-04) |
| `quantity_reference_field` | `quantity_reference_field` | そのまま使用 |
| `vendor_name` | `vendor_name` | そのまま使用 |
| `note` | `note` | そのまま使用 |
| `calculation_basis_note` | `calculation_basis_note` | そのまま使用 |
| `default_selected` | `default_selected` | `true/false` → `1/0` |
| `requires_manual_confirmation` | `requires_manual_confirmation` | `true/false` → `1/0` |
| `ai_check_target` | `ai_check_target` | `true` → `1` |
| `display_order` | `display_order` | そのまま使用 |
| `is_active` | `is_active` | `true` → `1` |
| `source_sheet_name` | `source_sheet_name` | そのまま使用 |
| `source_file_name` | `source_file_name` | そのまま使用 |
| `source_row_no` | `source_row_no` | そのまま使用 |
| (全JSONデータ) | `source_raw_json` | `JSON.stringify(item)` |

### フィールドマッピング: seed_item_versions → cost_master_item_versions

| シードフィールド | DBカラム | マッピング |
|----------------|---------|-----------|
| `id` | `id` (TEXT PK) | そのまま使用: `ver_item_foundation_lt60_v1` |
| `master_item_id` | `master_item_id` | そのまま使用 |
| `version_no` | `version_no` | そのまま使用 |
| `unit_price` | `unit_price` | そのまま使用（名前変更なし） |
| `fixed_amount` | `fixed_amount` | そのまま使用（名前変更なし） |
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
| `conditions` | `conditions_json` | **`JSON.stringify(conditions)`** |
| `actions` | `actions_json` | **`JSON.stringify(actions)`** |
| (なし) | `rule_name` | デフォルト: `id` と同値 (NEW-10) |
| (なし) | `is_active` | デフォルト: `1` (NEW-10) |
| (なし) | `valid_from` | デフォルト: `NULL` (NEW-10) |
| (なし) | `valid_to` | デフォルト: `NULL` (NEW-10) |

---

## 実装前に必須のシードデータ修正（v3追加）

### 修正1: lineup値のアンダースコア統一（NEW-01: Critical）

**対象**: `seed_rules_priority_a.json` の4箇所

| 修正箇所 | 修正前 | 修正後 |
|---------|--------|--------|
| rule_carpentry_moku_oyane → conditions[0].value | `"MOKU OOYANE"` | `"MOKU_OOYANE"` |
| rule_carpentry_moku_hiraya → conditions[0].value | `"MOKU HIRAYA"` | `"MOKU_HIRAYA"` |
| rule_carpentry_moku_roku → conditions[0].value | `"MOKU ROKU"` | `"MOKU_ROKU"` |
| 該当する追加ルールがあれば同様に修正 | スペース | アンダースコア |

**影響**: この修正なしでは、MOKU系ラインナップの木工事が一切自動計算されない。

### 修正2: item_panel_shipping の金額フィールド（NEW-02: Critical）

**対象**: `seed_items_priority_a.json` の1箇所

| フィールド | 修正前 | 修正後 |
|-----------|--------|--------|
| `calculation_type` | `"fixed_amount"` | `"fixed_amount"` (維持) |
| `current_unit_price` | `30000` | `null` |
| `current_fixed_amount` | `null` | `60000` |

**対応するルール修正** (`seed_rules_priority_a.json`):
- `rule_panel_shipping` の `actions` から `set_quantity: 2` を削除
- `set_fixed_amount: 60000` は維持

### 修正3: item_foundation_small_truck のcalculation_type（NEW-03: High）

**対象**: `seed_items_priority_a.json` の1箇所

| フィールド | 修正前 | 修正後 |
|-----------|--------|--------|
| `calculation_type` | `"fixed_amount"` | `"per_piece"` |
| `current_unit_price` | `3500` | `3500` (維持) |
| `current_fixed_amount` | `null` | `null` (維持) |
| `unit` | `"m3"` | `"m3"` (維持) |

**理由**: 生コン小型指定は数量 × 3,500/m3 の使い方であり、`per_piece` が正確。

---

## 投入順序

依存関係を考慮し、以下の順序で投入する。

```
Step 1: cost_categories（工種マスタ）37工種
    ↓
Step 2: cost_master_items（明細マスタ）
    ↓
Step 3: cost_master_item_versions（バージョン管理）
    ↓
Step 4: cost_rule_conditions（条件ルール）
    ↓
Step 5: quantity_rule_tables（数量算出ルール）← ファイル未存在時はスキップ (NEW-09)
    ↓
Step 6: product_catalog（商品カタログ）
    ↓
Step 7: area_rules（地域ルール）
```

> **Note**: `lineup_packages` はPhase 2用予約のため、Phase 1ではシードしない。
> **Note (v3追加)**: `seed_quantity_rules.json` が存在しない場合は、Step 5 を警告のみ出力してスキップする。

---

## import_seed_to_d1.ts 詳細仕様（v3追加）

### 必須バリデーション

#### Categories バリデーション
- `id` が `cat_` プレフィックスで始まること
- `category_code` が非空であること
- `sort_order` が正の整数であること
- `sort_order` の重複がないこと
- `gross_margin_group` が `standard / solar / option` のいずれかであること
- boolean → integer 変換: `requires_review`, `is_active`

#### Items バリデーション
- `id` が `item_` プレフィックスで始まること
- `id == "item_" + item_code` の命名規則チェック (NEW-11)
- `category_code` が categories に存在すること（参照整合性）
- `item_code` がユニークであること
- `calculation_type` が12パターンのいずれかであること
- `source_sheet_name` が非空であること（トレーサビリティ必須）
- boolean → integer 変換: `default_selected`, `requires_manual_confirmation`, `ai_check_target`, `is_active`
- **金額整合性チェック**: calculation_type と current_unit_price / current_fixed_amount の整合性（01_v3 の整合性ルール参照）

#### Versions バリデーション
- `master_item_id` が items に存在すること
- `version_no` が正の整数であること
- `effective_from` が非空であること
- 同一 `master_item_id` 内で `version_no` がユニークであること
- `unit_price` / `fixed_amount` と items側の金額が一致すること（v1では同額のはず）

#### Rules バリデーション
- `master_item_id` が items に存在すること
- `conditions` が配列であること
- `actions` が配列であること
- `conditions[].field` が projects テーブルのカラム名に存在すること
- `conditions[].operator` が許可演算子セット（`= / != / > / >= / < / <= / in / not_in / between`）内であること
- `actions[].type` が許可アクション種別（`select / deselect / set_quantity / set_fixed_amount / set_unit_price / set_reference_field / flag_manual_confirmation / show_warning / add_amount`）内であること

### SQL生成時の注意事項

1. **boolean→integer変換**: `true` → `1`, `false` → `0`
2. **JSON文字列のエスケープ**: `source_raw_json` は `JSON.stringify()` 後にSQLクォート必要。シングルクォート内のシングルクォートは `''` にエスケープ
3. **NULL処理**: JSONの `null` → SQLの `NULL`（クォートなし）
4. **配列型のJSON変換**: `conditions`(配列) → `conditions_json` = `JSON.stringify(conditions)`
5. **バッチ分割**: D1の100文バッチ制限に対応し、INSERT文を100件ずつに分割
6. **投入順序の保証**: categories → items → versions → rules の順序で生成
7. **デフォルト値補完**: ルールの `rule_name`, `is_active`, `valid_from`, `valid_to` は未定義時にデフォルト値を設定 (NEW-10)

### ファイル不存在時の処理 (NEW-09)

```
IF seed_quantity_rules.json が存在しない:
  WARN "seed_quantity_rules.json not found. Skipping quantity_rule_tables."
  CONTINUE（エラーにしない）
```

---

## Priority A シードファイルの検証結果

### Categories（10/37工種）

| id | category_code | sort_order | 検証結果 |
|----|--------------|-----------|---------|
| cat_foundation | foundation | 80 | OK |
| cat_carpentry | carpentry | 330 | OK |
| cat_insulation | insulation | 100 | OK |
| cat_shinkabe_panel | shinkabe_panel | 110 | OK |
| cat_electrical_facility | electrical_facility | 240 | OK |
| cat_roof | roof | 210 | OK |
| cat_site_management | site_management | 350 | OK |
| cat_defect_insurance | defect_insurance | **300** | OK (**v3: sort_orderをシードの300に確定。external_auditを295に調整**) |
| cat_cleaning | cleaning | 280 | OK |
| cat_waste_box | waste_box | 290 | OK |

### Items（49アイテム）- カテゴリ別内訳

| カテゴリ | アイテム数 | calculation_type 分布 |
|---------|----------|---------------------|
| foundation | 7 | range_lookup(3), per_meter(1), manual_quote(2), ~~fixed_amount(1)~~ **per_piece(1)** ← v3修正 |
| carpentry | 7 | lineup_fixed(3), rule_lookup(2), per_m2(1) |
| insulation | 5 | rule_lookup(5) |
| shinkabe_panel | 4 | rule_lookup(2), per_tsubo(1), fixed_amount(1) |
| electrical_facility | 6 | per_tsubo(2), fixed_amount(3), per_piece(1) |
| roof | 7 | per_m2(1), manual_quote(2), per_meter(3), manual_quote(1) |
| site_management | 1 | per_tsubo(1) |
| defect_insurance | 9 | fixed_amount(1), range_lookup(8) |
| cleaning | 6 | per_m2(4), fixed_amount(1), per_piece(1) |
| waste_box | 7 | package_with_delta(7) |

---

## スプレッドシート5フィールドの保持確認

| フィールド | 保持率 | 備考 |
|-----------|--------|------|
| 項目名 (`item_name`) | 49/49 (100%) | 全件に値あり |
| 現行金額 (`current_unit_price` / `current_fixed_amount`) | 49/49 (100%) | 排他的に設定 |
| 備考 (`note`) | 17/49 (35%) | 元シートにも備考なしの項目が多い |
| 発注先 (`vendor_name`) | 38/49 (78%) | 一部null |
| 算出根拠 (`calculation_basis_note`) | 49/49 (100%) | 全件に値あり |

---

## 残り27工種のシード作成計画

v2と同一（変更なし）。Priority B（10工種）、Priority C（5工種）、Priority Aの残り（12工種）。

---

## 投入後の検証方法（v3改訂版）

### 検証1〜4: v2と同一

### 検証5：テスト案件でのシミュレーション（v3: テスト4追加）

| テスト案件 | ラインナップ | 坪数 | 断熱等級 | 県内/外 | 検証ポイント |
|-----------|-------------|------|---------|--------|------------|
| テスト1 | SHIN | 35 | 5 | 県内 | 標準的な2階建て。全Priority A工種が正しく計算されること |
| テスト2 | RIN | 42 | 6 | 県内 | RIN加算(+50,000)、等級6切替（断熱材・パネル単価変更） |
| テスト3 | MOKU_HIRAYA | 28 | 5 | 県外 | MOKU固定額、県外産廃セット切替 |
| **テスト4** | **MOKU_OOYANE** | **30** | **6** | **県外** | **NEW-01修正確認: lineup値マッチ、MOKU固定額、等級6断熱、焼杉なし** |

### 検証6：ルール発火テスト（v3: NEW-01修正確認追加）

| ルール | 入力条件 | 期待結果 |
|--------|---------|---------|
| 基礎面積帯 | building_area_m2=72.5 | item_foundation_60_90 が選択される |
| 基礎面積帯 | building_area_m2=55 | item_foundation_lt60 が選択される |
| **MOKU自動選択** | **lineup=MOKU_OOYANE** | **item_carpentry_moku_oyane が選択される（NEW-01修正後）** |
| SHIN大工人工 | lineup=SHIN, tsubo=35 | quantity=55 が設定される |
| SHIN建方加算 | lineup=SHIN, tsubo=35 | fixed_amount=400,000 が設定される |
| RIN電気加算 | lineup=RIN | item_elec_rin_extra が選択される |
| 断熱等級6 | insulation_grade="6" | eq6系アイテム4件が選択される |
| 県内産廃 | is_shizuoka_prefecture=1 | 県内セット4アイテムが選択される |
| 県外産廃 | is_shizuoka_prefecture=0 | 県外セット3アイテムが選択される |
| 瑕疵担保 | total_floor_area_m2=115 | 100-125帯の保険・検査が選択される |
| 美装エリア外 | is_cleaning_area_standard=0 | clean_area_extra が選択される |
| **boolean型変換** | **has_yakisugi=1** | **item_carpentry_yakisugi が選択される（NEW-07型変換確認）** |

---

## 運用ルール

v2と同一（変更なし）。

---

*最終更新: 2026-03-07*
*改訂番号: v3（09_CROSS_REVIEW_PHASE2反映）*
