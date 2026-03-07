# 実装着手前チェックリスト v2（Go/No-Go 最終判定）

> **目的**: 実装を開始する前に、全てのブロッカー・未確定事項・前提条件が解消されていることを確認するための最終Go/No-Goチェックリスト。
> **方針**: このドキュメントの「Go/No-Go チェック」が全て ✅ になるまで、Step 0 以外の実装には着手しない。
> **改訂履歴**:
> - v1: 初版作成。ブロッカー5件、設計確定6件、前提条件9項目。
> - **v2: Go/No-Go 最終判定形式に全面改訂。01_DB_v4 / 03_SCREEN_v3 / 06_PLAN_v3 / 13_AI_v2 / 14_DEP_MAP_v2 との完全整合。正式 migration 確定、enum/check 制約確定、seed manifest 確定、CF Access 方式確定、app_users 運用確定、Step 0 スパイク手順確定、current_snapshot 切替仕様確定、diff UI 仕様確定の8項目を追加。数値整合性チェックを正式項目化。**

---

## Go/No-Go 最終判定

### 🔴 Go/No-Go チェック（全項目 ✅ で Step 1 以降開始可能）

| # | カテゴリ | チェック項目 | 状態 | 判定 |
|---|---------|------------|------|------|
| G-01 | migration | 正式 migration SQL が 25 テーブルを網羅 (12_MIGRATION_SQL_FINAL.md) | 計画完了 | ⬜ |
| G-02 | enum | 全 enum/CHECK 制約が 11_ENUM_STATUS_SPEC.md で定義済み (25テーブル分) | 完了 | ✅ |
| G-03 | seed | seed manifest 4ファイル + B-01/02/03 修正方針が確定 | 方針確定 | ⬜ |
| G-04 | auth | Cloudflare Access 方式（メール認証 or IdP）が確定 | 方式確定 | ⬜ |
| G-05 | users | app_users 初期 admin の運用方針が確定 | 方針確定 | ⬜ |
| G-06 | spike | Step 0 スパイク手順が確定 (下記セクション参照) | 確定 | ✅ |
| G-07 | snapshot | current_snapshot_id 切替仕様が確定 (shadow snapshot) | 確定 | ✅ |
| G-08 | diff | diff UI 仕様が確定 (03_SCREEN_DESIGN_v3.md 画面8) | 確定 | ✅ |
| G-09 | blocker | ブロッカー B-01/02/03 が修正済み | **未対応** | 🔴 |
| G-10 | blocker | ブロッカー B-04 migration SQL が配置済み | **未配置** | 🔴 |
| G-11 | env | Cloudflare Account + API Token が利用可能 | **未確認** | ⬜ |
| G-12 | docs | 全ドキュメントの数値整合性チェック完了 (下記セクション参照) | 完了 | ✅ |

**現在の判定: 🔴 No-Go** — G-09, G-10, G-11 の解消が必要

---

## 1. ブロッカー状態一覧

### 実装前に必須解決（Prerequisite）

| ID | 内容 | 重要度 | 状態 | 解決方法 |
|----|------|--------|------|---------|
| B-01 | lineup値アンダースコア統一 | **Critical** | **未対応** | seed_rules 4箇所: `MOKU_OOYANE`, `MOKU_HIRAYA`, `MOKU_ROKU` |
| B-02 | item_panel_shipping 金額修正 | **Critical** | **未対応** | items: unit_price→null, fixed_amount→60000 |
| B-03 | item_foundation_small_truck 修正 | **High** | **未対応** | calculation_type→per_piece |
| B-04 | migration SQL 配置 | **Critical** | **未配置** | 12_MIGRATION_SQL_FINAL.md → migrations/0001_initial_schema.sql |
| B-06 | 25テーブル v4 対応 | **Critical** | **✅ 完了** | 12_MIGRATION_SQL_FINAL.md に完全記載済み |

### 並行解決可（Parallel）

| ID | 内容 | 重要度 | 状態 | 解決タイミング |
|----|------|--------|------|-------------|
| B-05 | sort_order 衝突 | Medium | **✅ 解消済み** | v3 で解消 |
| B-07 | app_users 初期 admin 投入 | **High** | **準備中** | Step 1 完了時に対応 |
| B-08 | system_settings 初期データ | Medium | **✅ 計画完了** | 12_ に INSERT 文記載済み |

### ブロッカー件数整合（B-01〜B-08 = 8 ID）

```
ID 数: 8 (B-01, B-02, B-03, B-04, B-05, B-06, B-07, B-08)
  ├── 解消済み: B-05 (v3解消), B-06 (12_に記載), B-08 (12_に記載) = 3件
  ├── 未対応(実装前必須): B-01, B-02, B-03, B-04 = 4件
  └── 並行対応: B-07 = 1件
```

---

## 2. 設計確定事項（全確定済み）

| ID | 事項 | 確定先ドキュメント | 状態 |
|----|------|-----------------|------|
| D-01 | 金額カラム名マッピング (seed→DB) | 01_DB_v4 | ✅ |
| D-02 | ルール評価エンジンの型変換仕様 | 11_ENUM セクション21 | ✅ |
| D-03 | cost_rule_conditions デフォルト値 | 05_MASTER_v3 | ✅ |
| D-04 | item_code 命名規則 | 05_MASTER_v3 | ✅ |
| D-05 | package_with_delta 処理仕様 | 09_CROSS_REVIEW | ✅ |
| D-06 | sort_order 確定表 | 01_DB_v4 | ✅ |
| D-07 | shadow snapshot 方式 | 06_PLAN_v3, 14_DEP_MAP_v2 | ✅ |
| D-08 | Queue Job (SNAPSHOT_QUEUE) 方式 | 06_PLAN_v3, 14_DEP_MAP_v2 | ✅ |
| D-09 | RBAC 4ロール権限マトリクス | 11_ENUM セクション23, 14_DEP_MAP セクション6 | ✅ |
| D-10 | diff_type 7種定義 | 11_ENUM セクション13 | ✅ |
| D-11 | current_snapshot_id 循環参照解決方式 | 14_DEP_MAP セクション2-2 | ✅ |
| D-12 | 再生成 3種 job_type 仕様 | 11_ENUM セクション11 | ✅ |
| D-13 | 18画面詳細仕様 | 03_SCREEN_v3 | ✅ |
| D-14 | 禁止事項10項目 | 13_AI_DEV_TEAM_v2 | ✅ |

---

## 3. Step 0 スパイクテスト手順（確定）

Step 0 で実施するスパイクテスト。全テスト通過後に Step 1 へ進む。

### スパイク 1: D1 migration 実行環境

```bash
# 目的: migration が正常に適用されることを確認
npx wrangler d1 create spike-test-db
npx wrangler d1 migrations apply spike-test-db --local
# 検証: SELECT COUNT(*) FROM sqlite_master WHERE type='table' → 25
# 検証: CHECK制約テスト（不正 enum 値 INSERT → エラー）
# 完了後: spike-test-db 削除
```

### スパイク 2: seed dry-run

```bash
# 目的: import_seed_to_d1.ts のバリデーションが通ることを確認
npx ts-node scripts/import_seed_to_d1.ts --validate-only
# 検証: バリデーション結果に ERROR がないこと
# 検証: カラム名マッピングが正しいこと (D-01)
# 検証: boolean → INTEGER 変換が正しいこと
```

### スパイク 3: Cloudflare Access 疎通

```bash
# 目的: CF Access の JWT 検証が動くことを確認
# 方法 A: CF Access Application を仮設定し、JWTヘッダーを確認
# 方法 B: DEV_USER_EMAIL バイパスで auth.ts middleware の動作確認
curl -H "CF-Access-Authenticated-User-Email: admin@test.example.com" \
  http://localhost:3000/api/users/me
# 検証: 200 or 403 が正しく返ること
```

### スパイク 4: Queue / Consumer 疎通

```bash
# 目的: SNAPSHOT_QUEUE へのメッセージ送信 + Consumer 受信が動くこと
# 方法: wrangler pages dev --local で Queue binding を確認
# 最小テスト:
#   1. POST /api/projects/:id/calculate → 202 + job_id
#   2. Queue Consumer がメッセージを受信
#   3. job.status が 'queued' → 'running' → 'completed' に遷移
# 検証: cost_snapshot_jobs のステータス遷移
```

### スパイク 5: shadow snapshot 成立性

```bash
# 目的: shadow snapshot TX が D1 の制限内で完結することを確認
# 最小テスト:
#   1. テスト用 project 1件作成
#   2. Queue Consumer で最小計算（工種1つ、明細5件）
#   3. TX-2（snapshot + items + summaries + warnings + projects更新）が成功
#   4. 旧 snapshot が superseded に更新
# 検証: current_snapshot_id が新 snapshot を指す
# 検証: revision_no が +1 されている
```

### スパイク 6: partial index 検証（任意）

```bash
# 目的: D1 での partial index パフォーマンスを確認
# 方法: 100件程度のダミーデータで SELECT パフォーマンスを計測
# 結果: 問題なければそのまま、問題あれば INDEX 戦略を調整
```

### スパイク判定基準

```
全6スパイク通過 → Step 1 開始 GO
スパイク 1-3 通過、4-5 失敗 → Queue/Consumer 方式を再検討
スパイク 5 失敗 → 14_DEPENDENCY_MAP セクション8 の段階的除外を適用
```

---

## 4. current_snapshot_id 切替仕様（確定）

```
1. projects.current_snapshot_id は nullable INTEGER
2. DB 上の FK 制約は張らない（循環参照回避）
3. 初期値: NULL（計算未実行）
4. 切替タイミング: Queue Consumer TX-2 内で:
   a. 新 snapshot INSERT (status='active')
   b. 旧 snapshot UPDATE (status='superseded')
   c. UPDATE projects SET current_snapshot_id = ?, revision_no = revision_no + 1
5. 失敗時: TX-2 全体がロールバック → current_snapshot_id 不変（安全）
6. 参照時: GET /costs 等は current_snapshot_id 経由で最新 snapshot を取得
```

---

## 5. diff UI 仕様（確定）

03_SCREEN_DESIGN_v3.md 画面 8 (DIFF_REVIEW) に完全定義。

```
1. diff_type 7種を色分け表示
2. is_significant フラグで赤ハイライト（system_settings.diff_significant_threshold 参照）
3. 個別承認: PUT /diffs/:diffId/accept → item.review_status='confirmed'
4. 一括承認: PUT /diffs/accept-all?job_id=&significant_only=true/false
5. 承認権限: admin, manager のみ
6. diff 表示フィルタ: category_code, diff_type, is_significant
7. 旧値/新値/差額/変化率を表示
```

---

## 6. 数値整合性チェック（v2 確認済み）

### テーブル数

| ドキュメント | テーブル数 | 内訳 |
|-------------|----------|------|
| 01_DB_SCHEMA_DESIGN_v4.md | **25** | 既存16 + 新規9（v4追加7 + users置換1 + system_settings 1） |
| 12_MIGRATION_SQL_FINAL.md | **25** | CREATE TABLE 文 25個 |
| 11_ENUM_STATUS_SPEC.md | **25** | 対象テーブル 25 |
| 14_DEPENDENCY_MAP.md v2 | **25** | Layer 0〜6 で 25テーブル配置 |
| 06_PLAN_v3 Step 1 出力 | **25** | "D1に25テーブル" |
| 15_MANAGEMENT_ITEMS.md | **25** | STEP-01 完了条件 |
| **整合**: | ✅ **全一致** | |

> **注**: 14_DEP_MAP のセクション3-2 に「空23テーブル」という記載があるが、これはmigration適用時の初期状態（system_settings 9件は migration SQL 内でINSERT）。テーブル構造数は25で正しい。

### 画面数

| ドキュメント | 画面数 | 備考 |
|-------------|--------|------|
| 03_SCREEN_DESIGN_v3.md | **18** | Phase 1 必須画面 |
| 06_PLAN_v3 | **18** | 画面一覧テーブル |
| 14_DEP_MAP.md v2 セクション3-3 | **18** | 画面レイヤー表 |
| 15_MANAGEMENT_ITEMS.md | **18** | STEP-11 完了条件 |
| **整合**: | ✅ **全一致** | |

### ロール数

| ドキュメント | ロール数 | 値 |
|-------------|---------|-----|
| 11_ENUM セクション10 | **4** | admin, manager, estimator, viewer |
| 14_DEP_MAP セクション6 | **4** | 権限マトリクス 4列 |
| 06_PLAN_v3 | **4** | "4ロール" |
| 03_SCREEN_v3 | **4** | ロール別表示差分テーブル |
| **整合**: | ✅ **全一致** | |

### ブロッカー件数

| ドキュメント | ID範囲 | 件数 | 未対応 | 解消済み | 並行 |
|-------------|--------|------|--------|---------|------|
| 06_PLAN_v3 | B-01〜B-08 | **8 ID** | 4 | 3 | 1 |
| 10_CHECKLIST_v2 (本書) | B-01〜B-08 | **8 ID** | 4 | 3 | 1 |
| 15_MANAGEMENT_ITEMS.md | B-01〜B-08 | **7件記載** | - | - | - |
| **整合**: | ⚠ | 15_ は B-06 を省略（計画完了のため）。ID 数は 8 で統一 |

> **修正必要**: 15_MANAGEMENT_ITEMS.md の「7件」記載を「8 ID（うち3件解消済み）」に更新すべき。

### その他の数値

| 項目 | 全ドキュメント共通値 | 整合 |
|------|-------------------|------|
| 工種数 | 37 | ✅ |
| 計算方式数 | 12 | ✅ |
| diff_type 数 | 7 | ✅ |
| job_type 数 | 4 | ✅ |
| warning_type 数 | 9 | ✅ |
| severity 数 | 3 | ✅ |
| review_status 数 | 4 | ✅ |
| API エンドポイント数 | 50+ | ✅ |
| Priority A 工種数 | 17 | ✅ |
| seed データ件数 | categories:10, items:49, versions:49, rules:54 | ✅ |
| system_settings 初期件数 | 9 | ✅ |
| テスト案件パターン数 | 4 | ✅ |

---

## 7. ドキュメント正式版一覧（v2 更新）

| # | ドキュメント | 正式版 | v2 変更 |
|---|------------|--------|--------|
| 00 | PROJECT_OVERVIEW.md | 最新 | 要更新予定 |
| 01 | DB_SCHEMA_DESIGN_v4.md | **v4** | - |
| 02 | COST_CALCULATION_DEFINITIONS_v2.md | **v2** | - |
| 03 | SCREEN_DESIGN_v3.md | **v3** | **v2→v3 改訂** |
| 04 | OPENAI_API_DESIGN.md | v1 | - |
| 05 | MASTER_DATA_PLAN_v3.md | **v3** | - |
| 06 | PHASE1_IMPLEMENTATION_PLAN_v3.md | **v3** | **v2→v3 改訂** |
| 07 | CROSS_REVIEW_AND_RESOLUTIONS.md | v1 | - |
| 08 | OPERATIONAL_RUNBOOK.md | v1 | - |
| 09 | CROSS_REVIEW_PHASE2.md | v1 | - |
| 10 | IMPLEMENTATION_READINESS_CHECKLIST.md | **v2** | **本改訂** |
| 11 | ENUM_STATUS_SPEC.md | **v1** | - |
| 12 | MIGRATION_SQL_FINAL.md | **v1** | - |
| 13 | AI_DEV_TEAM_INSTRUCTIONS.md | **v2** | **v1→v2 改訂** |
| 14 | DEPENDENCY_MAP.md | **v2** | - |
| 15 | MANAGEMENT_ITEMS.md | **v1** | - |

---

## 8. Go/No-Go 解消手順

### G-09 解消手順（B-01/02/03 修正）

```
1. seed_rules_priority_a.json:
   grep "MOKU " → 0件になるまで MOKU_OOYANE/MOKU_HIRAYA/MOKU_ROKU に修正
   
2. seed_items_priority_a.json:
   item_panel_shipping: current_unit_price→null, current_fixed_amount→60000
   item_foundation_small_truck: calculation_type→per_piece
   
3. seed_rules_priority_a.json:
   rule_panel_shipping の set_quantity:2 を削除
   
4. 検証: import_seed_to_d1.ts --validate-only 通過
```

### G-10 解消手順（B-04 migration 配置）

```
1. 12_MIGRATION_SQL_FINAL.md の SQL を migrations/0001_initial_schema.sql にコピー
2. wrangler d1 migrations apply --local で適用テスト
3. SELECT COUNT(*) FROM sqlite_master WHERE type='table' → 25
4. CHECK制約テスト: INSERT 不正 enum → エラー確認
```

### G-11 解消手順（Cloudflare 環境）

```
1. Cloudflare Account 作成 or 確認
2. wrangler login or CLOUDFLARE_API_TOKEN 設定
3. npx wrangler whoami → 成功確認
4. D1/R2/Queue/Pages 作成権限の確認
```

---

## 9. 未確定事項（実装に影響しないが、将来対応が必要）

| # | 事項 | 影響範囲 | 対応時期 | Phase 1 代替 |
|---|------|---------|---------|-------------|
| U-01 | CF Access 詳細 IdP 設定 | 認証画面 | 本番デプロイ時 | DEV_USER_EMAIL バイパス |
| U-02 | seed_quantity_rules.json | WB部材の数量ルール | Priority B シード作成時 | 手入力 |
| U-03 | 足場工事の詳細シート | 計算方式未確定 | 平松建築に確認 | manual_quote |
| U-04 | 建材・副資材の詳細シート | 計算方式未確定 | 平松建築に確認 | manual_quote |
| U-05 | 設計本体費の原価含有 | 合計金額に影響 | 平松建築に確認 | 現行計算のまま |
| U-06 | RIN住宅設備パッケージ金額 | Priority B シード | 平松建築に確認 | SHIN基準で暫定 |

---

## 10. Step 0 完了 → Step 1 開始の判定フロー

```
Step 0 完了チェック:
  □ npm run build 成功
  □ /api/health → 200
  □ Zod スキーマ = 11_ セクション22 全網羅
  □ Git 初回コミット完了
  □ スパイク 1〜5 全通過
  
↓ 全 ✅

Go/No-Go チェック:
  □ G-09: B-01/02/03 修正済み + validate-only 通過
  □ G-10: B-04 migration SQL 配置済み
  □ G-11: Cloudflare 環境利用可能
  
↓ 全 ✅

Step 1 開始 GO
  → migration 適用
  → seed 投入
  → admin ユーザー投入
  → 検証クエリ 9本実行
```

---

*最終更新: 2026-03-07*
*改訂番号: v2（Go/No-Go 最終判定形式に全面改訂。スパイク手順、数値整合性チェック、diff UI仕様、snapshot切替仕様を正式追加）*
*前提ドキュメント: 01_DB_v4, 03_SCREEN_v3, 06_PLAN_v3, 11_ENUM, 12_MIGRATION, 13_AI_v2, 14_DEP_MAP_v2, 15_MGMT_v1*
