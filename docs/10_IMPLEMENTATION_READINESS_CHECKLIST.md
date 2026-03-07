# 実装着手前チェックリスト（Implementation Readiness Checklist）

> **目的**: 実装を開始する前に、全てのブロッカー・未確定事項・前提条件が解消されていることを確認するためのチェックリスト。
> **方針**: このドキュメントの全「ブロッカー」が解消されるまで実装には着手しない。

---

## 1. ブロッカー（実装前に必ず完了すべき事項）

### B-01: lineup値のアンダースコア統一 [NEW-01]

| 項目 | 内容 |
|------|------|
| 重要度 | **Critical** — 未対応なら木工事MOKU系が全く動かない |
| 対象ファイル | `seed_rules_priority_a.json` |
| 修正箇所 | 4箇所の `conditions[].value` |
| 修正内容 | `"MOKU OOYANE"` → `"MOKU_OOYANE"`, `"MOKU HIRAYA"` → `"MOKU_HIRAYA"`, `"MOKU ROKU"` → `"MOKU_ROKU"` |
| 検証方法 | テスト4（MOKU_OOYANE/30坪）で木工事が自動計算されること |
| 状態 | **未対応** |

### B-02: item_panel_shipping の金額フィールド修正 [NEW-02]

| 項目 | 内容 |
|------|------|
| 重要度 | **Critical** — import_seed_to_d1.ts のバリデーション不通過 |
| 対象ファイル | `seed_items_priority_a.json`, `seed_rules_priority_a.json` |
| 修正内容 | items: `current_unit_price: 30000` → `null`, `current_fixed_amount: null` → `60000` |
| ルール修正 | `rule_panel_shipping` の `set_quantity: 2` を削除 |
| 状態 | **未対応** |

### B-03: item_foundation_small_truck のcalculation_type修正 [NEW-03]

| 項目 | 内容 |
|------|------|
| 重要度 | **High** — 金額整合性バリデーション不通過 |
| 対象ファイル | `seed_items_priority_a.json` |
| 修正内容 | `calculation_type: "fixed_amount"` → `"per_piece"` |
| 状態 | **未対応** |

### B-04: マイグレーションSQL作成

| 項目 | 内容 |
|------|------|
| 重要度 | **Critical** — 全実装の前提条件 |
| 対象 | `migrations/0001_initial_schema.sql` |
| 内容 | 01_DB_SCHEMA_DESIGN_v3.md の全16テーブルのCREATE TABLE + INDEX |
| 参照 | 01_DB_SCHEMA_DESIGN_v3.md |
| 状態 | **未作成**（ドキュメント完備済み、コピー＋結合で作成可能） |

### B-05: 01_v3 sort_order衝突の解消 [NEW-08]

| 項目 | 内容 |
|------|------|
| 重要度 | **Medium** — 同一sort_order値があると表示順序が不定 |
| 修正内容 | `external_audit: 300` → `295`, `defect_insurance: 310` → `300` |
| 状態 | **完了**（01_DB_SCHEMA_DESIGN_v3.md に反映済み） |

---

## 2. 設計確定事項（v3で確定済み）

### D-01: 金額カラム名マッピング [NEW-04]

**確定**: 01_DB_SCHEMA_DESIGN_v3.md に正式規約として明文化済み。

```
seed_items.current_unit_price    → cost_master_items.base_unit_price
seed_items.current_fixed_amount  → cost_master_items.base_fixed_amount
seed_item_versions.unit_price    → cost_master_item_versions.unit_price
seed_item_versions.fixed_amount  → cost_master_item_versions.fixed_amount
```

### D-02: ルール評価エンジンの型変換仕様 [NEW-07]

**確定**: 01_DB_SCHEMA_DESIGN_v3.md に仕様として明文化済み。

| ルール条件の型 | 評価ロジック |
|--------------|------------|
| `value: true` | `field == 1` |
| `value: false` | `field == 0` |
| `value: "5"` | 文字列比較 |
| `value: 60` | 数値比較 |
| `value: ["SHIN", "RIN"]` | IN演算子 |

### D-03: cost_rule_conditions デフォルト値 [NEW-10]

**確定**: `rule_name` → idと同値、`valid_from/to` → NULL、`is_active` → 1

### D-04: item_code命名規則 [NEW-11]

**確定**: `id = "item_" + item_code` の規則で全49件一貫。import_seed_to_d1.ts で検証。

### D-05: `package_with_delta` の処理仕様

**確定**（09_CROSS_REVIEW_PHASE2.md 7-2で補完済み）:
1. `is_shizuoka_prefecture` で県内/県外セットを排他選択（ルールで実装済み）
2. 各アイテムの `current_unit_price × set_quantity` = パッケージ金額
3. 「差額」= 数量変更時の追加/減少分
4. UI: 標準数量を表示し、変更があれば差額を自動計算
5. 金額計算: `final_amount = unit_price × final_quantity`

### D-06: sort_order確定表

| id | sort_order (v2) | sort_order (v3確定) |
|----|----------------|-------------------|
| cat_external_audit | 300 | **295** |
| cat_defect_insurance | 310 | **300** |

---

## 3. ドキュメント改訂状況

| # | ドキュメント | 状態 | 内容 |
|---|------------|------|------|
| 1 | 01_DB_SCHEMA_DESIGN_v3.md | **完了** | sort_order修正、テーブル12-16追記、金額マッピング、型変換仕様、追加インデックス |
| 2 | 02_COST_CALCULATION_DEFINITIONS_v2.md | **完了** | 37工種統一、12計算方式、コード統一、瑕疵担保金額確定 |
| 3 | 03_SCREEN_DESIGN_v2.md | **完了** | 37工種、オプション粗利率、バージョンAPI、AI Phase1、再計算API |
| 4 | 05_MASTER_DATA_PLAN_v3.md | **完了** | sort_order修正、シードデータ修正方針、import仕様 |
| 5 | 09_CROSS_REVIEW_PHASE2.md | **完了** | 統合整合性検証結果（参照用、修正不要） |
| 6 | 10_IMPLEMENTATION_READINESS_CHECKLIST.md | **完了** | 本ドキュメント |
| 7 | 00_PROJECT_OVERVIEW.md | **要更新** | ドキュメント構成にv3版を追加 |

---

## 4. 実装開始時の前提条件チェック

実装着手前に以下を全て確認:

```
□ B-01 完了: seed_rules の lineup値がアンダースコア形式に統一されている
□ B-02 完了: item_panel_shipping の金額フィールドが修正されている
□ B-03 完了: item_foundation_small_truck のcalculation_typeが per_piece に修正されている
□ B-04 完了: migrations/0001_initial_schema.sql が作成されている
□ B-05 完了: sort_order衝突が解消されている（v3で完了済み）
□ D-01〜D-06 の設計事項がドキュメントに反映されている（v3で完了済み）
□ Hono + Cloudflare Pages プロジェクト初期化が可能な状態である
□ D1データベース作成コマンドが実行可能である
□ wrangler.jsonc の設定が完了している
```

---

## 5. 実装ステップ1で最初にやること

ブロッカー解消後、以下の順序で実装を開始する:

```
1. シードJSONファイルの修正（B-01, B-02, B-03）
2. Hono + Cloudflare Pages プロジェクト初期化
3. wrangler.jsonc 設定（D1バインディング含む）
4. マイグレーションファイル作成（01_v3のCREATE文を結合）
5. D1データベース作成 + マイグレーション適用
6. import_seed_to_d1.ts 作成（05_v3のバリデーション仕様準拠）
7. シードデータ投入
8. 投入後検証クエリ実行（05_v3の検証1〜6）
9. Git初期化 + 初回コミット
```

---

## 6. 未確定事項（実装に影響しないが、将来対応が必要）

| # | 事項 | 影響範囲 | 対応時期 |
|---|------|---------|---------|
| U-01 | 認証方式の詳細設定 | Cloudflare Accessの具体設定 | Step 1 |
| U-02 | seed_quantity_rules.json | WB部材の数量ルール | Priority B シード作成時 |
| U-03 | 足場工事の詳細シート | 計算方式未確定 | 平松建築に確認 |
| U-04 | 建材・副資材の詳細シート | 計算方式未確定 | 平松建築に確認 |
| U-05 | 設計本体費の原価含有 | 合計金額に影響 | 平松建築に確認 |
| U-06 | RIN住宅設備パッケージ金額 | Priority B シードに影響 | 平松建築に確認 |

---

## 7. 改訂対象ドキュメントのバージョン管理

現在の正式版（実装時に参照すべきドキュメント）:

| ドキュメント | 正式版 | 旧版（参考） |
|------------|--------|------------|
| プロジェクト概要 | 00_PROJECT_OVERVIEW.md | - |
| DB設計 | **01_DB_SCHEMA_DESIGN_v3.md** | 01_v2, 01_v1 |
| 計算方式定義 | **02_COST_CALCULATION_DEFINITIONS_v2.md** | 02_v1 |
| 画面設計 | **03_SCREEN_DESIGN_v2.md** | 03_v1 |
| OpenAI設計 | 04_OPENAI_API_DESIGN.md | - |
| マスタ投入計画 | **05_MASTER_DATA_PLAN_v3.md** | 05_v2, 05_v1 |
| 実装計画 | 06_PHASE1_IMPLEMENTATION_PLAN_v2.md | 06_v1 |
| クロスレビュー | 07_CROSS_REVIEW_AND_RESOLUTIONS.md | - |
| 運用ランブック | 08_OPERATIONAL_RUNBOOK.md | - |
| 統合検証 | 09_CROSS_REVIEW_PHASE2.md | - |
| 実装チェックリスト | **10_IMPLEMENTATION_READINESS_CHECKLIST.md** | - |

---

*最終更新: 2026-03-07*
*作成: 計画優先フェーズ（実装未着手）*
