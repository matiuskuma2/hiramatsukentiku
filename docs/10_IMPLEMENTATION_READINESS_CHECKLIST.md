# 実装着手前 Go/No-Go チェックリスト v2（正式改訂版）

> **目的**: 実装を開始する前に、全てのブロッカー・未確定事項・前提条件が解消されていることを確認するための最終判定チェックリスト。
> **方針**: 本ドキュメントの全「Go/No-Go 判定」項目がクリアされるまで正式実装には着手しない。Step 0 スパイクは本チェックリストと並行して実施可能。
> **改訂履歴**:
> - v1: 初版作成（ブロッカーB-01〜B-08、設計確定D-01〜D-06、実装ステップ概要）
> - **v2: 正式改訂。Go/No-Go 最終判定形式に全面再構成。正式 migration 確認、enum/CHECK 制約、seed マニフェスト、Cloudflare Access 方式、app_users 運用、Step 0 スパイク手順、current_snapshot 切替仕様、diff UI 仕様 を追加。ドキュメント参照を最新版に統一。数値整合性チェック表追加。**

---

## 1. Go/No-Go 最終判定マトリクス

> **判定ルール**: 全項目が ✅ になった時点で正式実装（Step 1 以降）に着手する。
> 🔴 = 未着手、🟡 = 対応中、✅ = 完了・確認済み

### 1-1. ブロッカー解消状況

| ID | 項目 | 重要度 | 状態 | 確認方法 | 担当 |
|----|------|--------|------|---------|------|
| B-01 | lineup 値アンダースコア統一 | Critical | 🔴 | `grep -c "MOKU " seed_rules_priority_a.json` = 0 | Seed修正 |
| B-02 | item_panel_shipping 金額修正 | Critical | 🔴 | JSON: `current_unit_price=null, current_fixed_amount=60000` | Seed修正 |
| B-03 | item_foundation_small_truck 修正 | High | 🔴 | JSON: `calculation_type="per_piece"` | Seed修正 |
| B-04 | マイグレーション SQL 配置 | Critical | 🔴 | `migrations/0001_initial_schema.sql` 存在 | Migration |
| B-05 | sort_order 衝突解消 | Medium | ✅ | `external_audit=295, defect_insurance=300` 反映済み | - |
| B-06 | 25テーブル v4 対応 Migration | Critical | ✅（計画完了） | 12_MIGRATION_SQL_FINAL.md に完全記載 | Migration |
| B-07 | app_users 初期 admin 投入 | High | 🔴 | CF Access メール確定後 INSERT | Step 1 |
| B-08 | system_settings 初期データ | Medium | ✅（計画完了） | 12_MIGRATION_SQL_FINAL.md に 9件 INSERT 記載 | Migration |

**判定**: B-01, B-02, B-03, B-04, B-07 が ✅ になるまで Step 1 は開始しない。

---

### 1-2. 正式 Migration 確認

| # | 確認項目 | 状態 | 確認方法 |
|---|---------|------|---------|
| M-01 | 12_MIGRATION_SQL_FINAL.md の SQL が **25テーブル** を網羅 | 🔴 | `grep -c "CREATE TABLE" 0001_initial_schema.sql` = 25 |
| M-02 | 全テーブルの CREATE INDEX が含まれる | 🔴 | 14_DEPENDENCY_MAP.md のインデックス一覧と照合 |
| M-03 | `wrangler d1 migrations apply --local` が成功 | 🔴 | コマンド実行、エラー0件 |
| M-04 | 適用後テーブル数 = 25 | 🔴 | `SELECT COUNT(*) FROM sqlite_master WHERE type='table'` = 25 |
| M-05 | 全テーブルの PK 型が設計書と一致 | 🔴 | TEXT PK 4テーブル、INTEGER AUTO 21テーブル |

---

### 1-3. Enum / CHECK 制約確認

| # | 確認項目 | 状態 | 確認方法 |
|---|---------|------|---------|
| E-01 | Migration SQL に全 CHECK 制約が含まれる | 🔴 | 11_ENUM_STATUS_SPEC.md の CHECK 定義と差分チェック |
| E-02 | Zod enum (src/schemas/enums.ts) が全 enum を網羅 | 🔴 | Step 0 成果: enum 数 = 22 以上 |
| E-03 | CHECK 制約値 = Zod enum 値が完全一致 | 🔴 | 自動比較スクリプトまたは手動照合 |
| E-04 | Boolean カラムが全て INTEGER(1/0) + CHECK | 🔴 | `grep -c "INTEGER.*CHECK.*IN (0, 1)"` で確認 |

---

### 1-4. Seed マニフェスト確認

| # | 確認項目 | 期待値 | 状態 | 確認方法 |
|---|---------|--------|------|---------|
| S-01 | cost_categories 件数 | **10** | 🔴 | `SELECT COUNT(*) FROM cost_categories` |
| S-02 | cost_master_items 件数 | **49** | 🔴 | `SELECT COUNT(*) FROM cost_master_items` |
| S-03 | cost_master_item_versions 件数 | **49** | 🔴 | `SELECT COUNT(*) FROM cost_master_item_versions` |
| S-04 | cost_rule_conditions 件数 | **54** | 🔴 | `SELECT COUNT(*) FROM cost_rule_conditions` |
| S-05 | system_settings 件数 | **9** | 🔴 | `SELECT COUNT(*) FROM system_settings` |
| S-06 | app_users (admin) 件数 | **≥1** | 🔴 | `SELECT COUNT(*) FROM app_users WHERE role='admin'` |
| S-07 | `import_seed_to_d1.ts --validate-only` 通過 | エラー0 | 🔴 | コマンド実行結果 |
| S-08 | item_code 命名規則一貫 | `id = "item_" + item_code` | 🔴 | バリデーションチェック |

---

### 1-5. Cloudflare Access 方式確認

| # | 確認項目 | 状態 | 確認方法 |
|---|---------|------|---------|
| A-01 | Cloudflare Access Application 作成済み | 🔴 | Zero Trust ダッシュボード確認 |
| A-02 | 認証ドメイン設定済み | 🔴 | アクセスすると CF 認証画面表示 |
| A-03 | JWT 検証方式が明確 | 🔴 | `CF-Access-Authenticated-User-Email` ヘッダー取得確認 |
| A-04 | 開発環境バイパス方式確定 | 🔴 | `.dev.vars` に `DEV_USER_EMAIL` 設定 |
| A-05 | Admin メールアドレス確定 | 🔴 | B-07 の前提条件 |

---

### 1-6. app_users 運用確認

| # | 確認項目 | 状態 | 確認方法 |
|---|---------|------|---------|
| U-01 | 初期 admin の email = CF Access 登録メール | 🔴 | app_users.email と CF Access 設定の一致 |
| U-02 | role = 'admin' で INSERT | 🔴 | `SELECT role FROM app_users WHERE id = 1` |
| U-03 | 未登録ユーザーの挙動 = 403 | 🔴 | CF Access 通過 → app_users 不在 → 403 画面表示 |
| U-04 | deactivate 後の挙動 = 403 | 🔴 | `status='inactive'` で 403 返却確認 |
| U-05 | ロール別メニュー差分 | 🔴 | 03_SCREEN_DESIGN_v3.md の共通UIコンポーネント仕様と照合 |

---

### 1-7. Step 0 スパイク手順と判定基準

| # | スパイク項目 | 成功条件 | 失敗時の対応 | 状態 |
|---|------------|---------|------------|------|
| SP-01 | CI パイプライン構築 | `npm run build` 成功 | tsconfig / vite 設定見直し | 🔴 |
| SP-02 | D1 Migration テスト環境 | `--local` で 25テーブル作成成功 | wrangler.jsonc binding 修正 | 🔴 |
| SP-03 | Seed dry-run 環境 | `--validate-only` エラー0 | seed JSON / import スクリプト修正 | 🔴 |
| SP-04 | CF Access 疎通テスト | JWT ヘッダー取得成功 | CF Access 設定見直し | 🔴 |
| SP-05 | 最小 Queue/Consumer テスト | send → consume 往復確認 | Queue binding / consumer 設定見直し | 🔴 |
| SP-06 | Partial index 検証 | `CREATE INDEX ... WHERE` 成功 | D1 制限を確認し代替案検討 | 🔴 |
| SP-07 | Shadow snapshot 成立性テスト | 5明細で TX 完走 | TX 分割戦略見直し | 🔴 |

**判定**: SP-01〜SP-07 全て成功で Step 0 完了。SP-05 または SP-07 が失敗した場合はアーキテクチャ見直しが必要。

---

### 1-8. current_snapshot 切替仕様確認

| # | 確認項目 | 仕様 | 状態 |
|---|---------|------|------|
| CS-01 | projects.current_snapshot_id の初期値 | NULL（計算未実行） | 🔴 |
| CS-02 | 新 snapshot 生成時の切替 | `UPDATE projects SET current_snapshot_id = ?` in TX | 🔴 |
| CS-03 | 旧 snapshot の扱い | `status = 'superseded'` に UPDATE（DELETE しない） | 🔴 |
| CS-04 | revision_no インクリメント | `revision_no = revision_no + 1` 同一 TX 内 | 🔴 |
| CS-05 | 循環参照の解決 | FK 制約なし、アプリ層で保証 | 🔴 |
| CS-06 | 失敗時の安全性 | TX 失敗 → 旧 snapshot 維持、current_snapshot_id 不変 | 🔴 |

---

### 1-9. Diff UI 仕様確認

| # | 確認項目 | 仕様 | 状態 |
|---|---------|------|------|
| D-01 | diff_type 7種の表示 | added/removed/amount_changed/quantity_changed/unit_price_changed/review_status_changed/override_changed | 🔴 |
| D-02 | is_significant フラグ表示 | 赤ハイライト（金額差 > 閾値） | 🔴 |
| D-03 | 個別承認 API | `PUT /api/projects/:id/diffs/:diffId/accept` | 🔴 |
| D-04 | 一括承認 API | `PUT /api/projects/:id/diffs/accept-all` | 🔴 |
| D-05 | 3種 job_type の表示差分 | preserve_reviewed / update_auto_only / replace_all | 🔴 |
| D-06 | replace_all 実行時の確認 UI | 確認ダイアログ必須（manager 以上のみ） | 🔴 |

---

## 2. 設計確定事項（全確定済み — 変更不可）

### D-01: 金額カラム名マッピング

```
seed_items.current_unit_price    → cost_master_items.base_unit_price
seed_items.current_fixed_amount  → cost_master_items.base_fixed_amount
seed_item_versions.unit_price    → cost_master_item_versions.unit_price
seed_item_versions.fixed_amount  → cost_master_item_versions.fixed_amount
```

### D-02: ルール評価エンジンの型変換仕様

| ルール条件の型 | 評価ロジック |
|--------------|------------|
| `value: true` | `field == 1` |
| `value: false` | `field == 0` |
| `value: "5"` | 文字列比較 |
| `value: 60` | 数値比較 |
| `value: ["SHIN", "RIN"]` | IN演算子 |

### D-03: cost_rule_conditions デフォルト値

`rule_name` → idと同値、`valid_from/to` → NULL、`is_active` → 1

### D-04: item_code 命名規則

`id = "item_" + item_code` の規則で全49件一貫。import_seed_to_d1.ts で検証。

### D-05: package_with_delta の処理仕様

1. `is_shizuoka_prefecture` で県内/県外セットを排他選択
2. 各アイテムの `current_unit_price × set_quantity` = パッケージ金額
3. 「差額」= 数量変更時の追加/減少分
4. UI: 標準数量を表示し、変更があれば差額を自動計算
5. 金額計算: `final_amount = unit_price × final_quantity`

### D-06: sort_order 確定表

| id | sort_order (確定) |
|----|------------------|
| cat_external_audit | **295** |
| cat_defect_insurance | **300** |

---

## 3. 数値整合性チェック表

> **全ドキュメントで以下の数値が一致していること。不一致発見時は実装中断。**

| 項目 | 正式値 | 01_DB_v4 | 03_SCREEN_v3 | 06_PLAN_v3 | 11_ENUM | 14_DEP_MAP_v2 | 15_MGMT |
|------|--------|---------|-------------|-----------|---------|-------------|---------|
| テーブル数 | **25** | 25 | - | 25 | 25 | 25 | 23(*) |
| 画面数 | **18** | - | 18 | 18 | - | 18 | 18 |
| ロール数 | **4** | - | 4 | - | 4 | 4 | 4 |
| 工種数 | **37** | - | 37 | 37 | - | 37 | 37 |
| 計算方式数 | **12** | - | 12 | 12 | 12 | 12 | 12 |
| ブロッカー | **B-01〜B-08** | - | - | 8 | - | - | 8 |
| 実質未解決 | **7件** | - | - | 7 | - | - | 7 |
| API数 | **50+** | - | 50+ | - | - | 50+ | - |

> (*) 15_MANAGEMENT_ITEMS.md の STEP-01 完了条件で「テーブル数 23」と記載。これは 25テーブル中 2テーブル（Phase 2用骨格: lineup_packages, product_catalog）がデータ未投入のため実質 23 とカウントした可能性がある。正式値は **25テーブル** である。更新が必要。

---

## 4. ドキュメント正式版一覧（実装時参照版）

| ドキュメント | 正式版 | 旧版（参考のみ） |
|------------|--------|----------------|
| プロジェクト概要 | 00_PROJECT_OVERVIEW.md | - |
| DB設計 | **01_DB_SCHEMA_DESIGN_v4.md** | v3, v2, v1 |
| 計算方式定義 | **02_COST_CALCULATION_DEFINITIONS_v2.md** | v1 |
| 画面設計 | **03_SCREEN_DESIGN_v3.md** | v2, v1 |
| OpenAI設計 | 04_OPENAI_API_DESIGN.md | - |
| マスタ投入計画 | **05_MASTER_DATA_PLAN_v3.md** | v2, v1 |
| 実装計画 | **06_PHASE1_IMPLEMENTATION_PLAN_v3.md** | v2, v1 |
| クロスレビュー | 07_CROSS_REVIEW_AND_RESOLUTIONS.md | - |
| 運用ランブック | 08_OPERATIONAL_RUNBOOK.md | - |
| 統合検証 | 09_CROSS_REVIEW_PHASE2.md | - |
| 実装チェックリスト | **10_IMPLEMENTATION_READINESS_CHECKLIST.md** (本ドキュメント) | v1 |
| Enum/ステータス仕様 | **11_ENUM_STATUS_SPEC.md** | - |
| マイグレーションSQL | **12_MIGRATION_SQL_FINAL.md** | - |
| AI開発チーム指示書 | **13_AI_DEV_TEAM_INSTRUCTIONS.md v3** | v2, v1 |
| 依存関係マップ | **14_DEPENDENCY_MAP.md v2** | v1 |
| 管理項目一覧 | **15_MANAGEMENT_ITEMS.md** | - |

---

## 5. 未確定事項（実装に影響しないが、将来対応が必要）

| # | 事項 | 影響範囲 | 対応時期 |
|---|------|---------|---------|
| U-01 | Cloudflare Access の詳細 IdP 設定 | 認証方式 | Phase 1 初期（Basic メール認証で開始） |
| U-02 | seed_quantity_rules.json | WB部材の数量ルール | Priority B シード作成時 |
| U-03 | 足場工事の詳細シート | 計算方式未確定 | 平松建築に確認 |
| U-04 | 建材・副資材の詳細シート | 計算方式未確定 | 平松建築に確認 |
| U-05 | 設計本体費の原価含有 | 合計金額に影響 | 平松建築に確認 |
| U-06 | RIN住宅設備パッケージ金額 | Priority B シードに影響 | 平松建築に確認 |

---

## 6. Go/No-Go 最終判定手順

### Phase 1: Step 0 スパイク（並行実施可）

```
1. SP-01〜SP-07 のスパイクを実施
2. 全スパイク成功 → Step 0 完了宣言
3. SP-05 or SP-07 失敗 → アーキテクチャレベルの見直し → 再計画
```

### Phase 2: ブロッカー解消

```
1. B-01, B-02, B-03: seed JSON ファイル修正
2. B-04: migrations/0001_initial_schema.sql 配置
3. B-07: admin ユーザー INSERT SQL 準備（CF Access メール確定待ち）
4. 全ブロッカー解消 → Go/No-Go 判定会議
```

### Phase 3: Go/No-Go 判定

```
判定基準:
  □ セクション1-1: 全ブロッカー ✅
  □ セクション1-2: Migration 確認 全項目 ✅
  □ セクション1-3: Enum/CHECK 確認 全項目 ✅
  □ セクション1-4: Seed マニフェスト 全項目 ✅
  □ セクション1-5: CF Access 確認 全項目 ✅
  □ セクション1-6: app_users 確認 全項目 ✅
  □ セクション1-7: Step 0 スパイク 全項目 ✅
  □ セクション1-8: current_snapshot 仕様 全項目 ✅
  □ セクション1-9: Diff UI 仕様 全項目 ✅
  □ セクション3: 数値整合性チェック 全項目一致

全項目 ✅ → **Go** → Step 1 以降の正式実装開始
いずれか 🔴 → **No-Go** → 該当項目の解消を優先
```

---

*最終更新: 2026-03-07*
*作成: 計画優先フェーズ（実装未着手）*
*改訂番号: v2（正式改訂 — Go/No-Go 最終判定形式、9カテゴリ判定、数値整合性チェック追加）*
*前提ドキュメント: 01_DB_v4, 03_SCREEN_v3, 06_PLAN_v3, 11_ENUM, 12_MIGRATION, 13_AI_DEV_v3, 14_DEP_MAP_v2, 15_MANAGEMENT_ITEMS*
