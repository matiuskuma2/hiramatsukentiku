# マスタデータ初期投入計画

## 概要

現行スプレッドシートの全データをシステムのマスタテーブルに移行する計画です。
マスタデータの品質がシステムの精度を決めるため、慎重に進めます。

---

## 投入順序

依存関係を考慮し、以下の順序で投入します。

```
Step 1: cost_categories（工種マスタ）
    ↓
Step 2: cost_master_items（明細マスタ/単価表）
    ↓
Step 3: cost_rule_conditions（条件ルール）
    ↓
Step 4: quantity_rule_tables（数量算出ルール）
    ↓
Step 5: lineup_packages（ラインナップ別パッケージ）
    ↓
Step 6: product_catalog（商品カタログ）
    ↓
Step 7: area_rules（地域ルール）
```

---

## Step 1: cost_categories（37工種）

全工種をシードデータとして投入。
02_COST_CALCULATION_DEFINITIONS.md の一覧をそのまま使用。

```sql
INSERT INTO cost_categories (category_code, category_name, sort_order, requires_review, margin_group) VALUES
('site_survey', '外部敷地調査', 10, 0, 'standard'),
('design', '設計業務', 20, 0, 'standard'),
('ground_survey', '地盤調査', 30, 1, 'standard'),
('earthwork', '土工事', 40, 1, 'standard'),
('temporary', '仮設工事', 50, 0, 'standard'),
('scaffolding', '足場工事', 60, 0, 'standard'),
('termite', '防蟻工事', 70, 0, 'standard'),
('foundation', '基礎工事', 80, 1, 'standard'),
('precut', 'プレカット・はがら下地材', 90, 0, 'standard'),
('insulation', '断熱材', 100, 0, 'standard'),
('shinkabe_panel', '真壁パネル', 110, 0, 'standard'),
('exterior_wall', '外壁工事', 120, 1, 'standard'),
('building_materials', '建材・副資材', 130, 0, 'standard'),
('hardware', '金物', 140, 0, 'standard'),
('crane', 'レッカー', 150, 0, 'standard'),
('wb_parts', 'WB部材', 160, 0, 'standard'),
('sash', 'サッシ・鋼製建具', 170, 1, 'standard'),
('interior_doors', '内装建具', 180, 1, 'standard'),
('lighting_equipment', '照明・電気設備機器', 190, 0, 'standard'),
('plastering', '左官工事', 200, 0, 'standard'),
('roofing', '屋根工事', 210, 0, 'standard'),
('tile_stone', 'タイル・石工事', 220, 1, 'standard'),
('interior_finish', '内装仕上工事', 230, 1, 'standard'),
('electrical', '電気設備工事', 240, 0, 'standard'),
('plumbing', '水道工事', 250, 1, 'standard'),
('tatami', '畳工事', 260, 0, 'standard'),
('septic_tank', '浄化槽工事', 270, 0, 'standard'),
('cleaning', '美装工事', 280, 0, 'standard'),
('waste_disposal', '産廃ボックス', 290, 0, 'standard'),
('external_audit', '外注監査', 300, 0, 'standard'),
('defect_insurance', '瑕疵担保保険', 310, 0, 'standard'),
('housing_equipment', '住宅設備', 320, 1, 'standard'),
('carpentry', '木工事', 330, 0, 'standard'),
('furniture', '家具製造', 340, 1, 'standard'),
('site_management', '現場管理費', 350, 0, 'standard'),
('solar', '太陽光工事', 360, 0, 'solar'),
('options', 'オプション', 370, 0, 'option');
```

---

## Step 2: cost_master_items（明細マスタ）

全工種の明細項目をシードデータとして投入。
以下は主要工種の例。実際は02_COST_CALCULATION_DEFINITIONS.mdの全項目を網羅。

### 投入数見込み
- 自動化A工種：約80項目
- 自動化B工種：約60項目
- 自動化C工種：約30項目
- 合計：約170〜200項目

### 例：基礎工事

```sql
-- 基礎工事の明細
INSERT INTO cost_master_items (category_id, item_code, item_name, unit, base_unit_price, calculation_type, reference_field, item_group, is_default_selected, note, calculation_basis, price_source) VALUES
((SELECT id FROM cost_categories WHERE category_code = 'foundation'),
 'FND_BASE_60_90', '基礎本体（60-90m2）', 'm2', 25000, 'per_m2', 'building_area_m2', 'basic', 1,
 '60〜90m2未満の場合', '面積帯別単価', 'internal_estimate'),

((SELECT id FROM cost_categories WHERE category_code = 'foundation'),
 'FND_BASE_90_PLUS', '基礎本体（90m2以上）', 'm2', 24000, 'per_m2', 'building_area_m2', 'basic', 1,
 '90m2以上の場合', '面積帯別単価', 'internal_estimate'),

((SELECT id FROM cost_categories WHERE category_code = 'foundation'),
 'FND_DEEP', '深基礎', 'm', 20000, 'per_meter', NULL, 'additional', 0,
 'H150以内。それ以外は要相談', '実績ベース', 'internal_estimate');
```

### 例：木工事

```sql
-- 木工事の明細（MOKU系）
INSERT INTO cost_master_items (category_id, item_code, item_name, unit, base_unit_price, calculation_type, reference_field, item_group, is_default_selected, note) VALUES
((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_MOKU_OOYANE', '木工事 MOKU大屋根', '式', 2100000, 'lineup_fixed', NULL, 'basic', 1,
 '土台、上棟込み、格子込み'),

((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_MOKU_HIRAYA', '木工事 MOKU平屋', '式', 2200000, 'lineup_fixed', NULL, 'basic', 1,
 '土台、上棟込み、格子込み'),

((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_MOKU_ROKU', '木工事 MOKU ROKU', '式', 1600000, 'lineup_fixed', NULL, 'basic', 1,
 '土台、上棟込み、格子込み');

-- 木工事の明細（SHIN/RIN系）
INSERT INTO cost_master_items (category_id, item_code, item_name, unit, base_unit_price, calculation_type, reference_field, item_group, is_default_selected, note) VALUES
((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_SHINRIN_29', '大工人工（〜29坪）', '式', 2500000, 'range_lookup', 'tsubo', 'basic', 1,
 '50日 × 50,000円/日'),

((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_SHINRIN_39', '大工人工（30〜39坪）', '式', 2750000, 'range_lookup', 'tsubo', 'basic', 1,
 '55日 × 50,000円/日'),

((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_SHINRIN_49', '大工人工（40〜49坪）', '式', 3000000, 'range_lookup', 'tsubo', 'basic', 1,
 '60日 × 50,000円/日');

-- 上棟加算
INSERT INTO cost_master_items (category_id, item_code, item_name, unit, base_unit_price, calculation_type, reference_field, item_group, is_default_selected, note) VALUES
((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_TATEMAE_24', '建方（〜24坪）', '式', 240000, 'range_lookup', 'tsubo', 'basic', 1,
 'SHIN/RINの場合のみ'),

((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_TATEMAE_34', '建方（25〜34坪）', '式', 340000, 'range_lookup', 'tsubo', 'basic', 1,
 'SHIN/RINの場合のみ'),

((SELECT id FROM cost_categories WHERE category_code = 'carpentry'),
 'CRP_TATEMAE_35PLUS', '建方（35坪以上）', '式', 400000, 'range_lookup', 'tsubo', 'basic', 1,
 'SHIN/RINの場合のみ');
```

---

## Step 3: cost_rule_conditions（条件ルール）

### 投入数見込み：約80〜120ルール

### 主要ルール例

```sql
-- ラインナップ条件
INSERT INTO cost_rule_conditions (item_id, rule_name, condition_field, operator, condition_value, action_type, action_value) VALUES
-- MOKU系の木工事自動選択
((SELECT id FROM cost_master_items WHERE item_code = 'CRP_MOKU_OOYANE'),
 'MOKU大屋根のみ', 'lineup', 'eq', 'MOKU_OOYANE', 'auto_select', NULL),

-- 電気設備RIN加算
((SELECT id FROM cost_master_items WHERE item_code = 'ELEC_RIN_ADD'),
 'RINの場合RIN加算', 'lineup', 'eq', 'RIN', 'auto_select', NULL),

-- 断熱等級による切替
((SELECT id FROM cost_master_items WHERE item_code = 'INS_ROOF_45MM'),
 '等級6のみ屋根45mm', 'insulation_grade', 'eq', '6', 'auto_select', NULL),

-- 浄化槽容量
((SELECT id FROM cost_master_items WHERE item_code = 'SEPTIC_7'),
 '延床145m2以上は7人槽', 'total_floor_area_m2', 'gte', '145', 'auto_select', NULL),

((SELECT id FROM cost_master_items WHERE item_code = 'SEPTIC_10'),
 '2世帯は10人槽', 'is_two_family', 'eq', '1', 'auto_select', NULL),

-- 産廃県内/県外
((SELECT id FROM cost_master_items WHERE item_code = 'WASTE_OUTSIDE_PREF'),
 '県外セット', 'prefecture', 'ne', '静岡県', 'auto_select', NULL),

-- 基礎面積帯
((SELECT id FROM cost_master_items WHERE item_code = 'FND_BASE_60_90'),
 '60-90m2帯', 'building_area_m2', 'between', '60,90', 'auto_select', NULL),

((SELECT id FROM cost_master_items WHERE item_code = 'FND_BASE_90_PLUS'),
 '90m2以上帯', 'building_area_m2', 'gte', '90', 'auto_select', NULL);
```

---

## Step 4: quantity_rule_tables（数量算出ルール）

WB部材のルックアップテーブルなど。

```sql
-- WB ハットヘルス 数量ルール
INSERT INTO quantity_rule_tables (item_id, rule_name, reference_field, range_min, range_max, result_quantity, note) VALUES
((SELECT id FROM cost_master_items WHERE item_code = 'WB_HAT_HEALTH'),
 'ハットヘルス数量', 'floor1_area_m2', 0, 46, 1, '各階の床面積で算出'),
((SELECT id FROM cost_master_items WHERE item_code = 'WB_HAT_HEALTH'),
 'ハットヘルス数量', 'floor1_area_m2', 46, 76, 2, NULL),
((SELECT id FROM cost_master_items WHERE item_code = 'WB_HAT_HEALTH'),
 'ハットヘルス数量', 'floor1_area_m2', 76, 106, 3, NULL);
```

---

## Step 5: lineup_packages（ラインナップ別パッケージ）

```sql
INSERT INTO lineup_packages (category_id, lineup, package_name, price_type, price_amount, note) VALUES
-- 設計業務
((SELECT id FROM cost_categories WHERE category_code = 'design'), 'SHIN', '設計費SHIN', 'fixed', 780000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'design'), 'RIN', '設計費RIN', 'fixed', 780000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'design'), 'MOKU_OOYANE', '設計費MOKU大屋根', 'fixed', 500000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'design'), 'MOKU_HIRAYA', '設計費MOKU平屋', 'fixed', 500000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'design'), 'MOKU_ROKU', '設計費MOKU ROKU', 'fixed', 500000, NULL),

-- 照明・電気設備機器
((SELECT id FROM cost_categories WHERE category_code = 'lighting_equipment'), 'MOKU_OOYANE', '照明MOKU大屋根', 'fixed', 250000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'lighting_equipment'), 'MOKU_HIRAYA', '照明MOKU平屋', 'fixed', 250000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'lighting_equipment'), 'MOKU_ROKU', '照明MOKU ROKU', 'fixed', 250000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'lighting_equipment'), 'RIN', '照明RIN', 'per_tsubo', 10000, NULL),
((SELECT id FROM cost_categories WHERE category_code = 'lighting_equipment'), 'SHIN', '照明SHIN', 'per_tsubo', 10000, NULL),

-- 住宅設備（水まわりパック）
((SELECT id FROM cost_categories WHERE category_code = 'housing_equipment'), 'MOKU_OOYANE', '水まわりクリナップ', 'fixed', 853000, '標準仕様'),
((SELECT id FROM cost_categories WHERE category_code = 'housing_equipment'), 'MOKU_HIRAYA', '水まわりクリナップ', 'fixed', 853000, '標準仕様'),
((SELECT id FROM cost_categories WHERE category_code = 'housing_equipment'), 'MOKU_ROKU', '水まわりクリナップ', 'fixed', 853000, '標準仕様'),
((SELECT id FROM cost_categories WHERE category_code = 'housing_equipment'), 'SHIN', '水まわりタカラ', 'fixed', 1061000, '標準仕様'),
((SELECT id FROM cost_categories WHERE category_code = 'housing_equipment'), 'RIN', '水まわりタカラ', 'fixed', 1061000, '標準仕様');
```

---

## Step 6: product_catalog（商品カタログ）

サッシ、内装建具、畳、太陽光、蓄電池のカタログ。

### 投入数見込み：約200〜300商品

```sql
-- サッシ例
INSERT INTO product_catalog (category_id, product_code, product_name, manufacturer, size_spec, unit, unit_price, is_standard, price_source, price_source_date) VALUES
((SELECT id FROM cost_categories WHERE category_code = 'sash'),
 'SASH_VENATO_D30', 'ヴェナートD30', 'LIXIL', '-', '枚', 194680, 0, 'vendor_quote', '2024-08-30'),
((SELECT id FROM cost_categories WHERE category_code = 'sash'),
 'SASH_CONCORD', 'コンコード片引き', 'LIXIL', '-', '枚', 269990, 0, 'vendor_quote', '2024-08-30'),
((SELECT id FROM cost_categories WHERE category_code = 'sash'),
 'SASH_HAKIDASHI_2560', '掃き出し窓 W2560×H2000', 'LIXIL', 'W2560×H2000', '枚', 77840, 0, 'vendor_quote', '2024-08-30');

-- 太陽光例
INSERT INTO product_catalog (category_id, product_code, product_name, manufacturer, size_spec, unit, unit_price, price_source, price_source_date) VALUES
((SELECT id FROM cost_categories WHERE category_code = 'solar'),
 'PV_SHARP_88_NF55', '太陽光8.8kw(20枚) NFパワコン5.5kw×1', 'シャープ', '8.8kW', 'セット', 1100000, 'vendor_quote', NULL),
((SELECT id FROM cost_categories WHERE category_code = 'solar'),
 'PV_SHARP_88_NF40X2', '太陽光8.8kw(20枚) NFパワコン4.0kw×2', 'シャープ', '8.8kW', 'セット', 1250000, 'vendor_quote', NULL);

-- 蓄電池例
INSERT INTO product_catalog (category_id, product_code, product_name, manufacturer, size_spec, unit, unit_price, price_source) VALUES
((SELECT id FROM cost_categories WHERE category_code = 'solar'),
 'BAT_65KWH', '蓄電池 6.5kWh', NULL, '6.5kWh', 'セット', 790000, 'vendor_quote'),
((SELECT id FROM cost_categories WHERE category_code = 'solar'),
 'BAT_95KWH', '蓄電池 9.5kWh', NULL, '9.5kWh', 'セット', 1000000, 'vendor_quote');
```

---

## Step 7: area_rules（地域ルール）

```sql
-- 浄化槽エリア加算
INSERT INTO area_rules (rule_type, city, amount, note) VALUES
('septic_surcharge', '菊川市', 20000, '立会い必要、2日施工'),
('septic_surcharge', '吉田町', 20000, '立会い必要、2日施工'),
('septic_surcharge', '牧之原市', 20000, '立会い必要、2日施工'),
('septic_surcharge', '御前崎市', 20000, '立会い必要、2日施工'),
('septic_surcharge', '島田市', 20000, '立会い必要、2日施工');

-- 美装エリア
INSERT INTO area_rules (rule_type, city, amount, note) VALUES
('cleaning_standard_area', '湖西市', 0, '標準エリア西端'),
('cleaning_standard_area', '菊川市', 0, '標準エリア東端');

-- 産廃エリア
INSERT INTO area_rules (rule_type, prefecture, amount, note) VALUES
('waste_area_shizuoka', '静岡県', 0, '県内：グリーンサイド'),
('waste_area_outside', NULL, 0, '県外：MSK');
```

---

## 投入後の検証方法

### 検証1：工種数の確認
```sql
SELECT COUNT(*) FROM cost_categories WHERE is_active = 1;
-- 期待値: 37
```

### 検証2：明細数の確認
```sql
SELECT cc.category_name, COUNT(cmi.id) as item_count
FROM cost_categories cc
LEFT JOIN cost_master_items cmi ON cc.id = cmi.category_id
GROUP BY cc.id
ORDER BY cc.sort_order;
```

### 検証3：テスト案件でのシミュレーション
- SHIN / 35坪 / 断熱等級5 の標準案件を作成
- 自動計算結果をスプレッドシートの結果と照合
- 差異があれば原因を特定して修正

### 検証4：ルール発火テスト
- 各条件ルールが正しく発火するかテスト
- RIN加算、等級6切替、浄化槽容量切替など

---

## 運用ルール

### 単価変更時
1. 新単価のcost_master_itemsを登録（valid_fromを設定）
2. 旧単価のvalid_toを設定
3. master_change_logsに理由を記録
4. 進行中案件に対する影響を通知

### 工種追加時
1. cost_categoriesに追加
2. 対応する明細をcost_master_itemsに追加
3. 条件ルールが必要ならcost_rule_conditionsに追加

---

*最終更新: 2026-03-07*
