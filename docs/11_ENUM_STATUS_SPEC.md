# Enum / ステータス / CHECK制約 統合仕様書

> **目的**: DB の CHECK 制約、Zod バリデーション、API レスポンス、フロントエンド表示で使用するすべての列挙型を**単一ドキュメント**で管理し、実装時の食い違いを防止する。
> **対象**: 01_DB_SCHEMA_DESIGN_v4 の全テーブル（既存16 + 新規9 = 25テーブル）

---

## 凡例

| 記号 | 意味 |
|------|------|
| **PK** | 値がそのまま PRIMARY KEY で使われる |
| **CHECK** | DB の CHECK 制約で強制する |
| **Zod** | API 入力バリデーションで使用する |
| **UI** | フロントエンドに表示ラベル／バッジがある |

---

## 1. projects テーブル

### 1-1. `status` — 案件ステータス

| 値 | 日本語 | 説明 | UI表示 |
|----|--------|------|--------|
| `draft` | 下書き | 初期状態。計算未実行 | 灰バッジ |
| `calculating` | 計算中 | スナップショットジョブ実行中 | 青スピナー |
| `in_progress` | 進行中 | 計算完了、確認作業中 | 青バッジ |
| `needs_review` | 要確認 | 未確認明細 or 警告あり | 黄バッジ |
| `reviewed` | 確認済 | 全工種確認完了 | 緑バッジ |
| `archived` | アーカイブ | 過去案件。編集不可 | 灰バッジ |

```sql
CHECK (status IN ('draft','calculating','in_progress','needs_review','reviewed','archived'))
```

```typescript
// Zod
const projectStatus = z.enum([
  'draft','calculating','in_progress','needs_review','reviewed','archived'
]);
```

### 1-2. `lineup` — ラインナップ（商品シリーズ）

| 値 | 日本語 | 説明 |
|----|--------|------|
| `SHIN` | SHIN | 標準仕様 |
| `RIN` | RIN | RIN仕様（設備パッケージ異なる） |
| `MOKU_OOYANE` | MOKU大屋根 | MOKU系・大屋根 |
| `MOKU_HIRAYA` | MOKU平屋 | MOKU系・平屋 |
| `MOKU_ROKU` | MOKUロク | MOKU系・ロク屋根 |

```sql
CHECK (lineup IN ('SHIN','RIN','MOKU_OOYANE','MOKU_HIRAYA','MOKU_ROKU'))
```

> **重要 (NEW-01)**: 値は必ず **アンダースコア形式**。シードルール `conditions.value` もこの形式に統一必須。

### 1-3. `roof_shape` — 屋根形状

| 値 | 日本語 |
|----|--------|
| `kirizuma` | 切妻 |
| `yosemune` | 寄棟 |
| `katanagare` | 片流れ |
| `flat` | 陸屋根 |
| `other` | その他 |

```sql
CHECK (roof_shape IS NULL OR roof_shape IN ('kirizuma','yosemune','katanagare','flat','other'))
```

### 1-4. `fire_zone_type` — 防火地域区分

| 値 | 日本語 |
|----|--------|
| `standard` | 標準（法22条） |
| `semi_fire` | 準防火 |
| `fire` | 防火 |

```sql
CHECK (fire_zone_type IN ('standard','semi_fire','fire'))
```

### 1-5. `insulation_grade` — 断熱等級

| 値 | 説明 |
|----|------|
| `5` | 等級5 |
| `6` | 等級6 |

```sql
CHECK (insulation_grade IS NULL OR insulation_grade IN ('5','6'))
```

> **注意**: TEXT型。数値ではない。

---

## 2. cost_categories テーブル

### 2-1. `gross_margin_group` — 粗利グループ

| 値 | 日本語 | 対象 |
|----|--------|------|
| `standard` | 標準 | 35工種 |
| `solar` | 太陽光 | 太陽光工事 |
| `option` | オプション | オプション工事 |

```sql
CHECK (gross_margin_group IN ('standard','solar','option'))
```

---

## 3. cost_master_items テーブル

### 3-1. `calculation_type` — 計算方式（12パターン）

| 値 | 日本語 | 金額カラム | 概要 |
|----|--------|-----------|------|
| `fixed_amount` | 固定額 | `base_fixed_amount` 必須 | 数量不問の一式金額 |
| `per_tsubo` | 坪単価 | `base_unit_price` 必須 | 坪数 × 単価 |
| `per_m2` | 面積単価 | `base_unit_price` 必須 | m2面積 × 単価 |
| `per_meter` | メートル単価 | `base_unit_price` 必須 | 長さ(m) × 単価 |
| `per_piece` | 個数単価 | `base_unit_price` 必須 | 個数 × 単価 |
| `range_lookup` | 範囲帯ルックアップ | 任意 | 面積帯テーブル参照 |
| `lineup_fixed` | ラインナップ別固定 | `base_fixed_amount` 必須 | ラインナップで固定額決定 |
| `rule_lookup` | ルール表参照 | 任意 | JSON条件で数量算出 |
| `manual_quote` | 都度見積 | 任意 | 手入力前提 |
| `product_selection` | 商品選択 | - | カタログ商品を選択 |
| `package_with_delta` | パッケージ＋差額 | `base_unit_price` 必須 | 標準セット＋差額管理 |
| `threshold_surcharge` | しきい値加算 | - | 基準値超過分を加算 |

```sql
CHECK (calculation_type IN (
  'fixed_amount','per_tsubo','per_m2','per_meter','per_piece',
  'range_lookup','lineup_fixed','rule_lookup','manual_quote',
  'product_selection','package_with_delta','threshold_surcharge'
))
```

### 3-2. `item_group` — 明細グループ

| 値 | 日本語 | 説明 |
|----|--------|------|
| `basic` | 基本 | 標準仕様に含まれる |
| `extra` | 追加 | 条件付き追加 |
| `option` | オプション | 任意選択 |

```sql
CHECK (item_group IN ('basic','extra','option'))
```

### 3-3. `section_type` — セクション種別（シード互換）

| 値 | 説明 |
|----|------|
| `basic` | 基本セクション |
| `extra` | 追加セクション |

```sql
CHECK (section_type IN ('basic','extra'))
```

---

## 4. cost_rule_conditions テーブル

### 4-1. `rule_group` — ルールグループ

| 値 | 日本語 | 説明 |
|----|--------|------|
| `selection` | 採用/非採用判定 | 明細の採用可否を決定 |
| `calculation` | 計算パラメータ設定 | 数量・単価を設定 |
| `warning` | 警告生成 | 警告メッセージを生成 |
| `cross_category` | 工種間連動 | 他工種の条件を参照 |

```sql
CHECK (rule_group IN ('selection','calculation','warning','cross_category'))
```

### 4-2. `conditions_json[].operator` — 条件演算子

| 値 | 意味 | 値の型 |
|----|------|--------|
| `=` | 等しい | string / number / boolean |
| `!=` | 等しくない | string / number / boolean |
| `>` | より大きい | number |
| `>=` | 以上 | number |
| `<` | より小さい | number |
| `<=` | 以下 | number |
| `in` | いずれかに含まれる | array |
| `not_in` | いずれにも含まれない | array |
| `between` | 範囲内（[min, max)） | [number, number] |

```typescript
const conditionOperator = z.enum([
  '=','!=','>','>=','<','<=','in','not_in','between'
]);
```

### 4-3. `actions_json[].type` — アクション種別

| 値 | 説明 | 付随する値 |
|----|------|-----------|
| `select` | 明細を採用 | なし |
| `deselect` | 明細を非採用 | なし |
| `set_quantity` | 数量を設定 | number |
| `set_fixed_amount` | 固定額を設定 | number |
| `set_unit_price` | 単価を設定 | number |
| `set_reference_field` | 参照フィールド設定 | string (カラム名) |
| `flag_manual_confirmation` | 手動確認フラグ | なし |
| `show_warning` | 警告表示 | string (メッセージ) |
| `add_amount` | 金額加算 | number |

```typescript
const actionType = z.enum([
  'select','deselect','set_quantity','set_fixed_amount',
  'set_unit_price','set_reference_field',
  'flag_manual_confirmation','show_warning','add_amount'
]);
```

---

## 5. project_cost_items テーブル

### 5-1. `review_status` — 確認ステータス

| 値 | 日本語 | UI表示 | 説明 |
|----|--------|--------|------|
| `pending` | 未確認 | ⬜ | 初期状態 |
| `confirmed` | 確認済 | ✅ | 担当者が確認完了 |
| `needs_review` | 要確認 | ⚠️ | 再確認が必要 |
| `flagged` | フラグ付き | 🔴 | 問題あり要対応 |

```sql
CHECK (review_status IN ('pending','confirmed','needs_review','flagged'))
```

---

## 6. project_cost_summaries テーブル

### 6-1. `review_status` — 工種集計確認ステータス

`project_cost_items.review_status` と同一の値セット。

```sql
CHECK (review_status IN ('pending','confirmed','needs_review','flagged'))
```

---

## 7. project_warnings テーブル（v4拡張）

### 7-1. `warning_type` — 警告タイプ

| 値 | 日本語 | 説明 |
|----|--------|------|
| `missing_input` | 入力不足 | 必要な項目が未入力 |
| `condition_unmet` | 条件未達 | ルール条件の確認が必要 |
| `threshold_exceeded` | しきい値超過 | 基準値を超過 |
| `area_surcharge` | 地域加算 | 地域ルールによる加算あり |
| `manual_required` | 手動確認必要 | 自動計算不可、手入力必要 |
| `cross_category` | 工種間連動 | 他工種の変更による影響 |
| `sales_estimate_gap` | 売価乖離 | **v4追加**: 原価と売価見積の乖離が閾値超過 |
| `master_price_expired` | 単価期限切れ | **v4追加**: マスタ単価の有効期限切れ |
| `version_mismatch` | バージョン不一致 | **v4追加**: スナップショット時と現行バージョンの不一致 |

```sql
CHECK (warning_type IN (
  'missing_input','condition_unmet','threshold_exceeded',
  'area_surcharge','manual_required','cross_category',
  'sales_estimate_gap','master_price_expired','version_mismatch'
))
```

### 7-2. `severity` — 重大度

| 値 | 日本語 | UI表示 |
|----|--------|--------|
| `info` | 情報 | 青 |
| `warning` | 警告 | 黄 |
| `error` | エラー | 赤 |

```sql
CHECK (severity IN ('info','warning','error'))
```

---

## 8. master_change_logs テーブル

### 8-1. `change_type` — 変更種別

| 値 | 日本語 |
|----|--------|
| `create` | 新規作成 |
| `update` | 更新 |
| `deactivate` | 無効化 |
| `price_change` | 単価変更 |
| `rule_change` | ルール変更 |

```sql
CHECK (change_type IN ('create','update','deactivate','price_change','rule_change'))
```

---

## 9. project_audit_logs テーブル

### 9-1. `action` — 操作種別

| 値 | 日本語 |
|----|--------|
| `create` | 新規作成 |
| `update` | 更新 |
| `recalculate` | 再計算 |
| `review` | 確認 |
| `override` | 手修正 |
| `snapshot` | **v4追加**: スナップショット生成 |
| `regenerate` | **v4追加**: 再生成 |

```sql
CHECK (action IN ('create','update','recalculate','review','override','snapshot','regenerate'))
```

### 9-2. `target_type` — 操作対象種別

| 値 | 対象テーブル |
|----|-------------|
| `project` | projects |
| `cost_item` | project_cost_items |
| `cost_summary` | project_cost_summaries |
| `snapshot` | **v4追加**: project_cost_snapshots |
| `sales_estimate` | **v4追加**: project_sales_estimates |

```sql
CHECK (target_type IN ('project','cost_item','cost_summary','snapshot','sales_estimate'))
```

---

## 10. app_users テーブル（v4新規）

### 10-1. `role` — ユーザーロール

| 値 | 日本語 | 権限概要 |
|----|--------|---------|
| `admin` | 管理者 | 全操作可能。マスタ管理、ユーザー管理 |
| `manager` | マネージャー | 案件管理、マスタ閲覧、承認操作 |
| `estimator` | 積算担当 | 案件作成・編集、原価計算 |
| `viewer` | 閲覧者 | 読み取りのみ |

```sql
CHECK (role IN ('admin','manager','estimator','viewer'))
```

### 10-2. `status` — アカウントステータス

| 値 | 日本語 |
|----|--------|
| `active` | 有効 |
| `inactive` | 無効 |
| `suspended` | 停止 |

```sql
CHECK (status IN ('active','inactive','suspended'))
```

---

## 11. cost_snapshot_jobs テーブル（v4新規）

### 11-1. `job_type` — ジョブ種別

| 値 | 日本語 | 説明 |
|----|--------|------|
| `initial` | 初回生成 | 案件作成後の初回スナップショット |
| `regenerate_preserve_reviewed` | 再生成(確認済保持) | 確認済み明細は維持、未確認のみ再計算 |
| `regenerate_auto_only` | 再生成(自動のみ) | 自動計算値のみ再生成、手修正保持 |
| `regenerate_replace_all` | 完全再生成 | 全明細を白紙から再計算 |

```sql
CHECK (job_type IN ('initial','regenerate_preserve_reviewed','regenerate_auto_only','regenerate_replace_all'))
```

### 11-2. `status` — ジョブステータス

| 値 | 日本語 | 説明 |
|----|--------|------|
| `queued` | キュー待ち | 実行待ち |
| `running` | 実行中 | 計算処理中 |
| `completed` | 完了 | 正常終了 |
| `failed` | 失敗 | エラー終了 |
| `cancelled` | キャンセル | 手動キャンセル |

```sql
CHECK (status IN ('queued','running','completed','failed','cancelled'))
```

**排他制約**: 同一 `project_id` に対して `status IN ('queued','running')` のジョブは**1件のみ**。

```sql
-- アプリ層で INSERT 前にチェック:
-- SELECT COUNT(*) FROM cost_snapshot_jobs
-- WHERE project_id = ? AND status IN ('queued','running')
-- → 0 のときのみ INSERT 許可
```

---

## 12. project_cost_snapshots テーブル（v4新規）

### 12-1. `status` — スナップショットステータス

| 値 | 日本語 | 説明 |
|----|--------|------|
| `active` | 有効 | 現在参照されているスナップショット |
| `superseded` | 置換済 | 新しいスナップショットで置き換えられた |
| `archived` | アーカイブ | 保存用 |

```sql
CHECK (status IN ('active','superseded','archived'))
```

---

## 13. project_cost_regeneration_diffs テーブル（v4新規）

### 13-1. `diff_type` — 差分種別

| 値 | 日本語 | 説明 |
|----|--------|------|
| `amount_changed` | 金額変更 | final_amount が変化 |
| `quantity_changed` | 数量変更 | final_quantity が変化 |
| `unit_price_changed` | 単価変更 | final_unit_price が変化 |
| `fixed_amount_changed` | 固定額変更 | auto_fixed_amount が変化 |
| `selection_changed` | 採用変更 | is_selected が変化 |
| `item_added` | 明細追加 | 新スナップショットに新規明細 |
| `item_removed` | 明細削除 | 新スナップショットから明細消失 |

```sql
CHECK (diff_type IN (
  'amount_changed','quantity_changed','unit_price_changed',
  'fixed_amount_changed','selection_changed','item_added','item_removed'
))
```

---

## 14. project_sales_estimates テーブル（v4新規）

### 14-1. `estimate_type` — 見積種別

| 値 | 日本語 | 説明 |
|----|--------|------|
| `rough` | 概算見積 | Phase 0 商談用 |
| `internal` | 社内原価 | Phase 1 本システム |
| `contract` | 契約見積 | Phase 2 |
| `execution` | 実行予算 | Phase 3 |

```sql
CHECK (estimate_type IN ('rough','internal','contract','execution'))
```

---

## 15. project_input_sources テーブル（v4新規）

### 15-1. `source_type` — 入力ソース種別

| 値 | 日本語 | 説明 |
|----|--------|------|
| `manual` | 手入力 | ユーザーが直接入力 |
| `spreadsheet` | スプレッドシート | 既存シートからインポート |
| `ai_extract` | AI読取 | PDF/画像からAI抽出 |
| `api_import` | API連携 | 外部APIからインポート |
| `seed_data` | シードデータ | 初期マスタデータ |

```sql
CHECK (source_type IN ('manual','spreadsheet','ai_extract','api_import','seed_data'))
```

---

## 16. external_references テーブル（v4新規）

### 16-1. `reference_type` — 参照種別

| 値 | 日本語 | 説明 |
|----|--------|------|
| `vendor_quote` | 業者見積 | 発注先からの見積書 |
| `catalog_price` | カタログ価格 | メーカーカタログ |
| `municipal_fee` | 自治体費用 | 水道・浄化槽等の行政費用 |
| `historical_data` | 過去実績 | 過去案件の実績データ |
| `drawing` | 図面 | CAD図面・建具表 |
| `regulation` | 規制情報 | 法規制・条例情報 |

```sql
CHECK (reference_type IN (
  'vendor_quote','catalog_price','municipal_fee',
  'historical_data','drawing','regulation'
))
```

---

## 17. system_settings テーブル（v4新規）

### 17-1. `setting_type` — 設定種別

| 値 | 日本語 | 説明 |
|----|--------|------|
| `threshold` | 閾値 | 警告発生の閾値設定 |
| `default_value` | デフォルト値 | 初期値設定 |
| `feature_flag` | 機能フラグ | 機能の有効/無効 |
| `notification` | 通知設定 | 通知ルール |
| `calculation` | 計算設定 | 計算エンジンのパラメータ |

```sql
CHECK (setting_type IN ('threshold','default_value','feature_flag','notification','calculation'))
```

---

## 18. lineup_packages テーブル

### 18-1. `price_type` — 価格種別

| 値 | 説明 |
|----|------|
| `fixed` | 固定額 |
| `per_tsubo` | 坪単価 |

```sql
CHECK (price_type IN ('fixed','per_tsubo'))
```

---

## 19. project_phase_estimates テーブル

### 19-1. `phase_type` — フェーズ種別

| 値 | 日本語 |
|----|--------|
| `consultation_rough` | 商談概算 |
| `internal_estimate` | 社内概算原価 |
| `contract_estimate` | 契約前見積 |
| `execution_budget` | 実行予算 |

```sql
CHECK (phase_type IN ('consultation_rough','internal_estimate','contract_estimate','execution_budget'))
```

---

## 20. 共通 Boolean → INTEGER 変換ルール

D1 (SQLite) は `BOOLEAN` 型を持たないため、すべてのフラグ値は `INTEGER` で格納する。

| JSON値 | DB値 | 説明 |
|--------|------|------|
| `true` | `1` | 真 |
| `false` | `0` | 偽 |
| `null` | `NULL` | 未設定 |

**対象カラム一覧**:

| テーブル | カラム | デフォルト |
|---------|--------|-----------|
| projects | `is_shizuoka_prefecture` | 1 |
| projects | `has_wb` | 1 |
| projects | `is_one_story` | 0 |
| projects | `is_two_family` | 0 |
| projects | `has_loft` | 0 |
| projects | `has_dormer` | 0 |
| projects | `has_pv` | 0 |
| projects | `has_battery` | 0 |
| projects | `has_water_intake` | 0 |
| projects | `has_sewer_intake` | 0 |
| projects | `has_water_meter` | 1 |
| projects | `has_yakisugi` | 0 |
| projects | `is_cleaning_area_standard` | 1 |
| cost_categories | `requires_review` | 0 |
| cost_categories | `is_active` | 1 |
| cost_master_items | `default_selected` | 0 |
| cost_master_items | `requires_manual_confirmation` | 0 |
| cost_master_items | `ai_check_target` | 1 |
| cost_master_items | `is_active` | 1 |
| cost_rule_conditions | `is_active` | 1 |
| project_cost_items | `is_selected` | 1 |
| project_warnings | `is_resolved` | 0 |
| area_rules | `requires_confirmation` | 0 |
| area_rules | `is_active` | 1 |
| product_catalog | `is_standard` | 0 |
| product_catalog | `is_active` | 1 |
| lineup_packages | `is_active` | 1 |
| quantity_rule_tables | `is_active` | 1 |
| app_users | `is_active` | 1 |

---

## 21. ルール評価エンジンの型変換仕様（NEW-07）

### conditions_json 値の型変換

| ルール側の型 | 値の例 | DB側の型 | 評価ロジック |
|-------------|--------|---------|-------------|
| boolean | `value: true` | INTEGER | `field == 1` |
| boolean | `value: false` | INTEGER | `field == 0` |
| string | `value: "5"` | TEXT | `field = '5'` |
| number | `value: 60` | REAL/INT | `field >= 60` |
| array (in) | `value: ["SHIN","RIN"]` | TEXT | `field IN ('SHIN','RIN')` |
| array (between) | `value: [60, 90]` | REAL | `field >= 60 AND field < 90` |

---

## 22. Zod スキーマ統合定義（実装用テンプレート）

```typescript
import { z } from 'zod';

// === 共通 Enum ===

export const ProjectStatus = z.enum([
  'draft','calculating','in_progress','needs_review','reviewed','archived'
]);

export const Lineup = z.enum([
  'SHIN','RIN','MOKU_OOYANE','MOKU_HIRAYA','MOKU_ROKU'
]);

export const InsulationGrade = z.enum(['5','6']);

export const RoofShape = z.enum(['kirizuma','yosemune','katanagare','flat','other']);

export const FireZoneType = z.enum(['standard','semi_fire','fire']);

export const GrossMarginGroup = z.enum(['standard','solar','option']);

export const CalculationType = z.enum([
  'fixed_amount','per_tsubo','per_m2','per_meter','per_piece',
  'range_lookup','lineup_fixed','rule_lookup','manual_quote',
  'product_selection','package_with_delta','threshold_surcharge'
]);

export const ItemGroup = z.enum(['basic','extra','option']);

export const SectionType = z.enum(['basic','extra']);

export const RuleGroup = z.enum(['selection','calculation','warning','cross_category']);

export const ConditionOperator = z.enum(['=','!=','>','>=','<','<=','in','not_in','between']);

export const ActionType = z.enum([
  'select','deselect','set_quantity','set_fixed_amount',
  'set_unit_price','set_reference_field',
  'flag_manual_confirmation','show_warning','add_amount'
]);

export const ReviewStatus = z.enum(['pending','confirmed','needs_review','flagged']);

export const WarningType = z.enum([
  'missing_input','condition_unmet','threshold_exceeded',
  'area_surcharge','manual_required','cross_category',
  'sales_estimate_gap','master_price_expired','version_mismatch'
]);

export const Severity = z.enum(['info','warning','error']);

export const ChangeType = z.enum(['create','update','deactivate','price_change','rule_change']);

export const AuditAction = z.enum([
  'create','update','recalculate','review','override','snapshot','regenerate'
]);

export const AuditTargetType = z.enum([
  'project','cost_item','cost_summary','snapshot','sales_estimate'
]);

export const UserRole = z.enum(['admin','manager','estimator','viewer']);

export const UserStatus = z.enum(['active','inactive','suspended']);

export const SnapshotJobType = z.enum([
  'initial','regenerate_preserve_reviewed','regenerate_auto_only','regenerate_replace_all'
]);

export const SnapshotJobStatus = z.enum(['queued','running','completed','failed','cancelled']);

export const SnapshotStatus = z.enum(['active','superseded','archived']);

export const DiffType = z.enum([
  'amount_changed','quantity_changed','unit_price_changed',
  'fixed_amount_changed','selection_changed','item_added','item_removed'
]);

export const EstimateType = z.enum(['rough','internal','contract','execution']);

export const SourceType = z.enum(['manual','spreadsheet','ai_extract','api_import','seed_data']);

export const ReferenceType = z.enum([
  'vendor_quote','catalog_price','municipal_fee','historical_data','drawing','regulation'
]);

export const SettingType = z.enum(['threshold','default_value','feature_flag','notification','calculation']);

export const PriceType = z.enum(['fixed','per_tsubo']);

export const PhaseType = z.enum([
  'consultation_rough','internal_estimate','contract_estimate','execution_budget'
]);
```

---

## 23. 認証・認可マトリクス（Cloudflare Access + app_users）

### 認証フロー

```
[ユーザー] → Cloudflare Access (Zero Trust) → JWT検証 → app_users照合 → ロール判定
```

### ロール別アクセス権限

| 操作 | admin | manager | estimator | viewer |
|------|-------|---------|-----------|--------|
| マスタ管理 (CRUD) | ✅ | ❌ | ❌ | ❌ |
| ユーザー管理 | ✅ | ❌ | ❌ | ❌ |
| system_settings 変更 | ✅ | ❌ | ❌ | ❌ |
| 案件作成 | ✅ | ✅ | ✅ | ❌ |
| 案件編集 | ✅ | ✅ | ✅(自分の) | ❌ |
| 原価計算実行 | ✅ | ✅ | ✅ | ❌ |
| 手修正 | ✅ | ✅ | ✅ | ❌ |
| 確認(review) | ✅ | ✅ | ❌ | ❌ |
| 案件アーカイブ | ✅ | ✅ | ❌ | ❌ |
| ダッシュボード閲覧 | ✅ | ✅ | ✅ | ✅ |
| 案件詳細閲覧 | ✅ | ✅ | ✅ | ✅ |
| マスタ閲覧 | ✅ | ✅ | ✅ | ✅ |
| 変更履歴閲覧 | ✅ | ✅ | ✅ | ✅ |
| シードデータ投入 | ✅ | ❌ | ❌ | ❌ |

---

## 24. Step 0 失敗時の段階的デプロイ方針

shadow-snapshot スパイクテスト失敗時、以下の順序で低優先度カテゴリを **一時的に計算対象から除外** し、優先度の高いカテゴリから段階的にデプロイする。除外判断は **PM/オーナー** が行う。

### 除外優先順位（先に除外 → 影響が小さい）

| 除外順 | カテゴリ | 理由 |
|--------|---------|------|
| 1 | `options` (オプション) | 金額影響小、手入力可 |
| 2 | `furniture` (家具製造) | 都度見積前提 |
| 3 | `tile_stone` (タイル・石) | 図面依存、手入力前提 |
| 4 | `tatami` (畳工事) | 商品選択型、自動計算不要 |
| 5 | `interior_doors` (内装建具) | 商品選択型 |
| 6 | `sash` (サッシ) | 商品選択型 |
| 7 | `earthwork` (土工事) | 都度見積前提 |
| 8 | `scaffolding` (足場) | 詳細シート未提出 |
| 9 | `building_materials` (建材) | 詳細シート未提出 |

> **残すべきカテゴリ**: 基礎、木工事、断熱、パネル、電気、屋根、現場管理、瑕疵担保、美装、産廃 — これらは Priority A に含まれ、金額影響が大きいため最後まで維持。

---

*最終更新: 2026-03-07*
*作成: v4 設計拡張フェーズ*
*対象: 全25テーブル（既存16 + 新規9）*
