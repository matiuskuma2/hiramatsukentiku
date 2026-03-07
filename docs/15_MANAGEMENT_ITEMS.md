# 管理項目一覧（Phase 1 実装管理）

> **目的**: 各管理項目の入力・出力・完了条件・検証方法・担当ロール・依存先を一覧化し、実装の進捗と品質を追跡可能にする。  
> **方針**: 06_PHASE1_IMPLEMENTATION_PLAN_v3.md、14_DEPENDENCY_MAP.md v2 と連携。  
> **AI品質チェックガイドライン**: 未入手。入手次第、検証方法に品質チェック項目を追加。

---

## 凡例

| 状態 | 記号 | 説明 |
|------|------|------|
| 未着手 | ⬜ | 開始条件を満たしていない |
| 着手可能 | 🟡 | 開始条件を満たした |
| 進行中 | 🔵 | 作業中 |
| 完了 | ✅ | 完了条件を満たした |
| ブロック中 | 🔴 | 依存先が未完了 |

---

## 1. ブロッカー管理項目（B系列）

### B-01: lineup値アンダースコア統一

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **分類** | 実装前必須 (Prerequisite) |
| **入力** | seed_rules_priority_a.json（4箇所のlineup conditions.value） |
| **出力** | 修正済み seed_rules_priority_a.json |
| **完了条件** | conditions.value が `MOKU_OOYANE`, `MOKU_HIRAYA`, `MOKU_ROKU` 形式に統一。`MOKU OOYANE` 等のスペース区切りが残っていない |
| **検証方法** | `grep -c "MOKU " seed_rules_priority_a.json` → 0件 |
| **担当ロール** | 開発者 |
| **依存先** | なし |
| **影響先** | Step 1（シード投入）, Step 5（ルール評価）|

### B-02: item_panel_shipping 金額修正

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **分類** | 実装前必須 (Prerequisite) |
| **入力** | seed_items_priority_a.json, seed_rules_priority_a.json |
| **出力** | unit_price→null, fixed_amount→60000 に修正済みJSON |
| **完了条件** | item_panel_shipping の current_unit_price = null, current_fixed_amount = 60000, 関連ルールの金額も整合 |
| **検証方法** | JSON内の item_panel_shipping レコードを目視確認 + import_seed_to_d1.ts --validate-only 通過 |
| **担当ロール** | 開発者 |
| **依存先** | なし |
| **影響先** | Step 1, Step 5（fixed_amount ハンドラー） |

### B-03: item_foundation_small_truck calculation_type修正

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **分類** | 実装前必須 (Prerequisite) |
| **入力** | seed_items_priority_a.json |
| **出力** | calculation_type = "per_piece" に修正済みJSON |
| **完了条件** | item_foundation_small_truck.calculation_type = "per_piece" |
| **検証方法** | JSON内の該当レコード確認 + import_seed_to_d1.ts --validate-only |
| **担当ロール** | 開発者 |
| **依存先** | なし |
| **影響先** | Step 1, Step 5（per_piece ハンドラー） |

### B-04: マイグレーションSQL配置

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手（12_MIGRATION_SQL_FINAL.md は完成済み） |
| **分類** | 実装前必須 (Prerequisite) |
| **入力** | 12_MIGRATION_SQL_FINAL.md |
| **出力** | migrations/0001_initial_schema.sql |
| **完了条件** | ファイルが配置され、`wrangler d1 migrations apply --local` が成功 |
| **検証方法** | `SELECT COUNT(*) FROM sqlite_master WHERE type='table'` → 25 |
| **担当ロール** | 開発者 |
| **依存先** | Step 0（プロジェクト初期化） |
| **影響先** | Step 1（全後続ステップの基盤） |

### B-07: app_users 初期admin投入

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **分類** | 並行解決可 (Parallel) |
| **入力** | Cloudflare Access 設定で使用するメールアドレス |
| **出力** | app_users テーブルに admin レコード1件 |
| **完了条件** | `SELECT * FROM app_users WHERE role='admin' AND status='active'` → 1件 |
| **検証方法** | 上記SQL + 認証ミドルウェアでのログインテスト |
| **担当ロール** | 開発者 + PM（メール確定） |
| **依存先** | Step 1（migration適用後）, CF Access メール確定 |
| **影響先** | Step 2（認証ミドルウェア開発・テスト） |

### B-08: system_settings 初期データ確認

| 項目 | 内容 |
|------|------|
| **状態** | ✅ 12_MIGRATION_SQL_FINAL.md に INSERT文記載済み |
| **分類** | 並行解決可 (Parallel) |
| **入力** | 12_MIGRATION_SQL_FINAL.md 内の INSERT文 |
| **出力** | system_settings に9件投入 |
| **完了条件** | `SELECT COUNT(*) FROM system_settings` → 9 |
| **検証方法** | 上記SQL + 各設定値の妥当性確認 |
| **担当ロール** | 開発者 |
| **依存先** | Step 1（migration適用） |
| **影響先** | Step 6（売価乖離閾値）, Step 7（diff有意性判定閾値） |

---

## 2. 環境・インフラ管理項目

### ENV-01: Cloudflare リソース作成

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **入力** | Cloudflare Account 認証情報 |
| **出力** | D1 Database, R2 Bucket, Queue, Pages Project の各ID |
| **完了条件** | `npx wrangler whoami` 成功, 全リソースIDが wrangler.jsonc に記載 |
| **検証方法** | wrangler.jsonc の binding 設定確認 + `npx wrangler d1 list` |
| **担当ロール** | 開発者 |
| **依存先** | Cloudflare Account |
| **影響先** | Step 0 全体 |

### ENV-02: Cloudflare Access 設定

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **入力** | ドメイン名, 許可メールアドレス一覧 |
| **出力** | CF Access Application 設定完了 |
| **完了条件** | 設定済みドメインへのアクセスで CF Access 認証画面が表示される |
| **検証方法** | ブラウザからドメインアクセス → 認証フロー確認 |
| **担当ロール** | 開発者 + PM（メール・IdP決定） |
| **依存先** | ENV-01 |
| **影響先** | Step 2（認証ミドルウェア本番連携） |

### ENV-03: OPENAI_API_KEY 設定

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **入力** | OpenAI API キー |
| **出力** | Secret設定 or .dev.vars 設定 |
| **完了条件** | `wrangler pages secret list` に OPENAI_API_KEY が表示 or .dev.vars に記載 |
| **検証方法** | AI条件チェックAPI呼出しで200返却 |
| **担当ロール** | 開発者 |
| **依存先** | ENV-01 |
| **影響先** | Step 10（AI条件チェック） |

---

## 3. Step別 管理項目

### STEP-00: 環境セットアップ + CI基盤

| 項目 | 内容 |
|------|------|
| **状態** | ⬜ 未着手 |
| **入力** | 12_MIGRATION_SQL_FINAL.md, 11_ENUM_STATUS_SPEC.md, wrangler.jsonc テンプレート |
| **出力** | 動作する Hono プロジェクト + Zod スキーマ + ファイル構成骨格 |
| **完了条件** | □ `npm run build` 成功 □ `/api/health` → 200 □ Zodスキーマ=11_セクション22全網羅 □ Git初回コミット完了 |
| **検証方法** | TypeScript コンパイル, curl テスト, Zod enum数照合 |
| **担当ロール** | 開発者 |
| **依存先** | なし（起点） |
| **工数** | 2日 |

### STEP-01: DB + Migration + Seed

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（B-01, B-02, B-03, B-04 待ち） |
| **入力** | migration SQL, 4 seed JSON (修正済み), admin メールアドレス |
| **出力** | D1に25テーブル + マスタデータ + admin ユーザー |
| **完了条件** | □ テーブル数=25 □ categories=10 □ items=49 □ versions=49 □ rules=54 □ admin=1 □ settings=9 □ CHECK制約テスト通過 □ 参照整合性OK |
| **検証方法** | 検証SQL9本実行 + CHECK違反テスト + import --validate-only |
| **担当ロール** | 開発者 |
| **依存先** | STEP-00, B-01, B-02, B-03, B-04 |
| **工数** | 1日 |

### STEP-02: 認証ミドルウェア + ユーザー管理

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-01 待ち） |
| **入力** | 11_ENUM_STATUS_SPEC.md セクション10, 23 |
| **出力** | auth.ts + rbac.ts + ユーザー管理API 5本 + 開発バイパス |
| **完了条件** | □ 未認証→401/403 □ 未登録→403 □ viewer POST→403 □ admin CRUD成功 □ deactivate後403 □ /me 動作 |
| **検証方法** | curl テスト × 4ロール × 主要操作 |
| **担当ロール** | 開発者 |
| **依存先** | STEP-01 |
| **工数** | 1日 |

### STEP-03: マスタ管理 API + 画面

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-02 待ち） |
| **入力** | 01_DB_v4, 03_SCREEN_v3, 05_MASTER_v3 |
| **出力** | マスタAPI 16本 + 画面4画面 + 変更履歴自動記録 |
| **完了条件** | □ GET categories=10件 □ バージョン追加+ログ記録 □ 権限チェック(admin以外403) □ 画面操作可能 |
| **検証方法** | API レスポンス検証 + master_change_logs INSERT確認 + 画面操作テスト |
| **担当ロール** | 開発者 |
| **依存先** | STEP-02 |
| **工数** | 3日 |

### STEP-04: 案件CRUD + ダッシュボード

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-03 待ち, 部分並行可） |
| **入力** | 01_DB_v4 projects, 03_SCREEN_v3 |
| **出力** | 案件API 5本 + ダッシュボード + 案件作成/詳細画面 + 楽観ロック |
| **完了条件** | □ YYYY-NNN自動採番 □ フィルタ/検索 □ 楽観ロック(409) □ audit_logs記録 □ 粗利率デフォルト |
| **検証方法** | 楽観ロック衝突テスト + 採番連番テスト + ダッシュボード表示テスト |
| **担当ロール** | 開発者 |
| **依存先** | STEP-03（部分並行可） |
| **工数** | 2日 |

### STEP-05: 計算エンジンコア ★最重要

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-03 待ち） |
| **入力** | 02_COST_v2, 01_DB_v4, 11_ENUM セクション21, 05_MASTER_v3 |
| **出力** | 12ハンドラー + ルール評価器 + 2パスロジック + final_*算出 + D1バッチ + テスト |
| **完了条件** | □ 12ハンドラー全テスト通過 □ 9演算子×型変換テスト通過 □ cross_categoryルール発火 □ 4パターン金額一致 |
| **検証方法** | ユニットテスト全通過 + スプレッドシート突合4パターン |
| **担当ロール** | 開発者（最重要・最大工数） |
| **依存先** | STEP-03 |
| **工数** | 6日 |

### STEP-06: スナップショットジョブ

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-05 待ち） |
| **入力** | 14_DEP_MAP セクション4-1, 01_DB_v4 (jobs, snapshots), 11_ENUM セクション11-12 |
| **出力** | 計算API(202) + Queue Consumer + shadow snapshot + 売価乖離チェック |
| **完了条件** | □ 202+job_id □ 二重ジョブ→409 □ snapshot生成完了 □ current_snapshot_id更新 □ revision_no++ □ 失敗→job=failed,旧維持 |
| **検証方法** | calculate→ポーリング→結果確認フロー + 排他テスト + 失敗テスト |
| **担当ロール** | 開発者 |
| **依存先** | STEP-05 |
| **工数** | 3日 |

### STEP-07: 再生成 + diff生成

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-06 待ち） |
| **入力** | 01_DB_v4 (diffs), 11_ENUM セクション13 (diff_type 7値) |
| **出力** | 再生成API(3種job_type) + diff生成(7種diff_type) + diff参照/承認API |
| **完了条件** | □ preserve_reviewed正常 □ auto_only正常 □ replace_all正常 □ 7種diff生成 □ is_significant正確 □ diff承認→confirmed |
| **検証方法** | 初回計算→条件変更→再生成→diff確認フロー × 3種job_type |
| **担当ロール** | 開発者 |
| **依存先** | STEP-06 |
| **工数** | 3日 |

### STEP-08: 原価一覧・工種詳細画面

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-06 + STEP-04 待ち, 部分並行可） |
| **入力** | 03_SCREEN_v3 (COST_OVERVIEW, COST_CATEGORY) |
| **出力** | COST_OVERVIEW + COST_CATEGORY(インライン編集) + ログイン導線 + 共通ヘッダー |
| **完了条件** | □ 37工種表示 □ 計算実行→ポーリング→更新 □ 手修正保存 □ override_reason必須 □ 楽観ロック409 □ ログイン導線 |
| **検証方法** | 案件作成→計算→結果表示フロー + 手修正テスト + 楽観ロックテスト |
| **担当ロール** | 開発者 |
| **依存先** | STEP-06, STEP-04（並行可能部分あり） |
| **工数** | 4日 |

### STEP-09: サマリー・売価・diff解決・ユーザー管理UI

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-08 + STEP-07 待ち） |
| **入力** | 03_SCREEN_v3 (COST_SUMMARY), 01_DB_v4 (sales_estimates, diffs) |
| **出力** | COST_SUMMARY + 売価見積保存 + DIFF_REVIEW + USER_MGMT |
| **完了条件** | □ 3グループ集計正確 □ 売価保存 □ diff一覧表示(7種色分け) □ diff承認 □ 一括承認 □ ユーザーCRUD □ admin以外403 |
| **検証方法** | サマリー金額手計算照合 + diff承認テスト + ユーザー管理テスト |
| **担当ロール** | 開発者 |
| **依存先** | STEP-08, STEP-07 |
| **工数** | 3日 |

### STEP-10: 警告・変更履歴・AI条件チェック・設定

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（STEP-09 待ち, 部分並行可） |
| **入力** | 04_OPENAI_API_DESIGN (機能B), 01_DB_v4 (warnings, logs) |
| **出力** | WARNINGS画面 + CHANGE_LOG + AIチェック + SETTINGS |
| **完了条件** | □ 警告フィルタ+解決 □ 変更履歴時系列表示 □ AIチェックでwarning生成 □ settings CRUD(admin) |
| **検証方法** | 警告テスト + AI結果妥当性 + 設定変更テスト |
| **担当ロール** | 開発者 |
| **依存先** | STEP-09, ENV-03（AI用） |
| **工数** | 2日 |

### STEP-11: 検証・仕上げ・ドキュメント最終化

| 項目 | 内容 |
|------|------|
| **状態** | 🔴 ブロック中（全Step完了待ち） |
| **入力** | スプレッドシート実データ, 05_MASTER_v3 検証パターン |
| **出力** | テスト結果レポート + 本番デプロイ + 最終ドキュメント |
| **完了条件** | □ 4パターン突合一致 □ 12ルールパターン発火 □ 18画面正常 □ 4ロール権限正常 □ 楽観ロック □ 再生成→diff→承認 □ 本番health=200 |
| **検証方法** | 突合レポート + 本番テスト + PM/オーナーレビュー |
| **担当ロール** | 開発者 + PM/オーナーレビュー |
| **依存先** | 全Step |
| **工数** | 1日 |

---

## 4. 横断管理項目

### CROSS-01: Git コミット管理

| 項目 | 内容 |
|------|------|
| **ルール** | 各Step完了時に必ずコミット。コミットメッセージに Step番号を含む |
| **形式** | `[Step-XX] 概要` 例: `[Step-01] DB migration + seed data import` |
| **検証** | `git log --oneline` で各Step分のコミットが存在 |

### CROSS-02: ドキュメント整合性

| 項目 | 内容 |
|------|------|
| **ルール** | 実装中にドキュメントとの差異が生じた場合、即座にドキュメントも更新 |
| **対象** | 01_DB_v4, 03_SCREEN_v3/v3, 06_PLAN_v3, 11_ENUM, 14_DEP_MAP |
| **検証** | Step 11 でドキュメントバージョン一覧の最終確認 |

### CROSS-03: テスト網羅性

| 項目 | 内容 |
|------|------|
| **ルール** | 各Stepの完了条件にテスト項目を含める。ユニットテスト + 結合テスト |
| **最低限** | 計算エンジン12ハンドラー × テストケース、権限4ロール × 操作、楽観ロック |
| **検証** | テスト実行結果のログ保持 |

### CROSS-04: AI品質チェックガイドライン対応

| 項目 | 内容 |
|------|------|
| **状態** | 未入手。入手次第、以下に反映 |
| **反映先** | 各Stepの検証方法、CROSS-03のテスト基準 |
| **暫定基準** | 型安全（TypeScript strict）、テスト駆動、ドキュメント整合性、コードレビュー可能性 |

---

## 5. 成果物トレーサビリティマトリクス

| 成果物 | 入力ドキュメント | 対応Step | 検証方法 |
|--------|----------------|---------|---------|
| migrations/0001_initial_schema.sql | 12_MIGRATION_SQL | STEP-01 | テーブル数=23 |
| src/schemas/enums.ts | 11_ENUM_STATUS_SPEC | STEP-00 | Zod enum数照合 |
| src/middleware/auth.ts | 11_ENUM セクション10,23 | STEP-02 | 権限テスト |
| src/middleware/rbac.ts | 11_ENUM セクション23 | STEP-02 | 4ロール×操作テスト |
| src/engine/handlers/*.ts (12種) | 02_COST_CALC_v2 | STEP-05 | ユニットテスト+突合 |
| src/engine/ruleEvaluator.ts | 11_ENUM セクション21 | STEP-05 | 9演算子×型変換テスト |
| src/engine/calculator.ts | 02_COST_CALC_v2 | STEP-05 | 2パステスト+突合 |
| src/services/snapshotJobProcessor.ts | 14_DEP_MAP セクション4 | STEP-06 | フロー通貫テスト |
| scripts/import_seed_to_d1.ts | 05_MASTER_DATA_v3 | STEP-01 | --validate-only |
| マスタ管理API (16本) | 01_DB_v4, 03_SCREEN_v3 | STEP-03 | APIレスポンス検証 |
| 案件管理API (5本) | 01_DB_v4, 03_SCREEN_v3 | STEP-04 | 楽観ロック+採番テスト |
| 計算API+Queue Consumer | 14_DEP_MAP セクション4-1 | STEP-06 | 排他+ポーリングテスト |
| 再生成API+diff | 14_DEP_MAP セクション4-2 | STEP-07 | 3種job_type×diffテスト |
| AI条件チェックAPI | 04_OPENAI_API | STEP-10 | AIレスポンス妥当性 |
| 画面18画面 | 03_SCREEN_v3/v3 | STEP-08,09,10 | 全画面操作テスト |
| テスト結果レポート | スプレッドシート実データ | STEP-11 | 4パターン突合一致 |

---

## 6. 依存関係サマリー（DAG簡易版）

```
B-01,02,03 ──┐
              ├──> STEP-01 ──> STEP-02 ──> STEP-03 ──┬──> STEP-05 ──> STEP-06 ──> STEP-07
B-04 ────────┘                                        │                    │
STEP-00 ─────┘                                        │                    │
                                                      └──> STEP-04         │
                                                              │             │
                                                              ▼             ▼
                                                         STEP-08 ──> STEP-09 ──> STEP-10 ──> STEP-11
                                                              ↑                      ↑
                                                         (STEP-06並行可)       (STEP-09部分並行可)
ENV-01 ──> ENV-02 ──> STEP-02(本番)
ENV-01 ──> ENV-03 ──> STEP-10(AI)
```

---

## 7. マイルストーン定義

| マイルストーン | 達成条件 | 目標日 | 依存Step |
|-------------|---------|--------|---------|
| **M1: 基盤完成** | DB稼働 + 認証動作 + マスタ閲覧可能 | Day 7 | STEP-00,01,02,03 |
| **M2: 計算エンジン完成** | 4パターン突合一致 + スナップショット動作 | Day 19 | STEP-05,06 |
| **M3: 再生成・diff完成** | 3種job_type動作 + diff表示 | Day 22 | STEP-07 |
| **M4: 画面完成** | 全18画面操作可能 | Day 27 | STEP-08,09,10 |
| **M5: Phase 1完成** | 成功基準15項目全達成 + 本番デプロイ | Day 31 | STEP-11 |

---

## 8. 品質チェックポイント

### 各Step完了時の共通チェック

| # | チェック項目 | 確認方法 |
|---|-----------|---------|
| Q-01 | TypeScript strict モードでコンパイルエラーなし | `npx tsc --noEmit` |
| Q-02 | Zod スキーマが 11_ENUM_STATUS_SPEC.md と完全一致 | enum値数の照合 |
| Q-03 | 新規APIエンドポイントにRBACミドルウェア適用済み | コードレビュー |
| Q-04 | DB操作にトランザクション使用（14_DEP_MAP セクション5 準拠） | コードレビュー |
| Q-05 | D1バッチ100件制限の考慮 | d1Batch.ts 使用確認 |
| Q-06 | 楽観ロック対応（更新系API） | version パラメータ確認 |
| Q-07 | master_change_logs / project_audit_logs の自動記録 | ログテーブルINSERT確認 |
| Q-08 | エラーレスポンスの一貫性（400/401/403/404/409/500） | APIレスポンス確認 |

### AI品質チェックガイドライン（未入手・後追い反映予定）

```
暫定基準:
  □ 型安全性: TypeScript strict, Zod バリデーション
  □ テスト駆動: ユニットテスト先行（計算エンジン）
  □ ドキュメント整合性: 実装とドキュメントの差異ゼロ
  □ コードレビュー可能性: 関数サイズ適正、命名規約統一
  □ セキュリティ: APIキー非露出、権限チェック網羅
```

---

*最終更新: 2026-03-07*
*改訂番号: v1（初版。06_v3, 14_v2 と連携）*
*AI品質チェックガイドライン: 未入手・後追い反映*
