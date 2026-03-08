# Phase 1 実装計画 v3（全面改訂版）

> **改訂履歴**:
> - v1: 初版作成
> - v2: 07_CROSS_REVIEW_AND_RESOLUTIONS.md 反映。リスク対策具体化、工数修正
> - **v3: 全面改訂。v4テーブル設計統合、shadow snapshot / Queue Job 方式固定、ユーザー管理・顧客管理・ログインUI追加、依存関係明示（14_DEPENDENCY_MAP v2連携）、ブロッカー分類、AI品質チェック基準考慮（ガイドライン未入手・後追い反映）、画面設計改訂内容を反映**

---

## 方針

1. **実装は行わない** — 本ドキュメントは計画の精緻化のみ
2. **shadow snapshot 方式固定** — 計算結果は常に新スナップショットとして生成し、旧を superseded に更新
3. **snapshot 生成は Queue Job** — Cloudflare Queues で非同期実行、ポーリングで完了検知
4. **revision_no 一本化** — スナップショット生成ごとにインクリメント、1案件に1連番
5. **3種の再生成フラグ** — preserve_reviewed / update_auto_only / replace_all
6. **依存関係と管理項目を最重視** — 14_DEPENDENCY_MAP.md v2 と連携
7. **AI品質チェックガイドライン** — 未入手。入手次第差分反映。現時点では型安全・テスト駆動・ドキュメント整合性・コードレビュー可能性を適用

---

## Phase 1 の定義

**ゴール**: 現行スプレッドシートと同じ条件を入れたら、同じ工種が出て、同じ金額が出て、どこを人が確認すべきかも分かる状態にする。加えて、最低限の運用に必要なユーザー管理・認証・ログインUIを含む。

**制約**:
- Cloudflare Pages + Workers + D1 + R2 + Queues
- OpenAI APIは条件チェック機能のみPhase 1に含む
- 認証は Cloudflare Access (Zero Trust) + 事前登録 app_users
- 対象ユーザーは社内5〜10名

**Phase 1 必須コンポーネント（v3確定）**:
- shadow snapshot 方式
- snapshot 生成 Queue Job
- 統一 revision_no
- preserve_reviewed / update_auto_only / replace_all フラグ
- project_cost_regeneration_diffs
- projects.current_snapshot_id (nullable FK, アプリ層保証)
- Cloudflare Access + app_users 事前登録認証
- project_sales_estimates
- project_input_sources（骨格のみ、Phase 2でAI読取連携）
- project_warnings
- external_references（骨格テーブルのみ）
- system_settings（初期9件投入）
- 原価関連テーブル骨格（cost_items, summaries, snapshots, jobs, diffs）
- 統一 migration / seed / import / CI 管理

---

## ブロッカー分類

### 実装前に必須解決（前提条件 = Prerequisite）

| ID | 内容 | 重要度 | 依存先 | 解決方法 | 分類根拠 |
|----|------|--------|--------|---------|---------|
| B-01 | lineup値のアンダースコア統一 | Critical | seed_rules_priority_a.json 4箇所 | value修正: `MOKU_OOYANE` 等 | シードデータ投入失敗の原因になるため |
| B-02 | item_panel_shipping 金額修正 | Critical | seed_items/rules_priority_a.json | unit_price→null, fixed_amount→60000 | 計算結果の正確性に直結 |
| B-03 | item_foundation_small_truck 修正 | High | seed_items_priority_a.json | calculation_type→per_piece | 計算ハンドラー選択に影響 |
| B-04 | マイグレーションSQL配置 | Critical | 12_MIGRATION_SQL_FINAL.md | SQLコピー → migrations/0001_initial_schema.sql | DB存在しないと全機能不可 |
| B-06 | 25テーブル v4対応 | Critical | 12_MIGRATION_SQL_FINAL.md | ✅ 計画完了（12_に完全記載済み） | - |

### 実装中に並行解決可（Parallel）

| ID | 内容 | 重要度 | 解決タイミング | 分類根拠 |
|----|------|--------|-------------|---------|
| B-07 | app_users 初期admin投入 | High | Step 1完了時 | CF Accessメール確定後にINSERT。Step 2開始時に必要 |
| B-08 | system_settings 初期データ確認 | Medium | Step 1完了時 | ✅ 12_MIGRATION_SQL_FINAL.md にINSERT文記載済み |
| B-05 | sort_order衝突 | Medium | ✅ v3で解消済み | - |

### Phase 1 後回し可（Post-Phase 1）

| ID | 内容 | 理由 | Phase 1 での代替 |
|----|------|------|----------------|
| U-01 | Cloudflare Access 詳細IdP設定 | 初期はBasicメール認証で十分 | DEV_USER_EMAIL バイパス |
| U-02 | seed_quantity_rules.json | Priority B。Phase 1スコープ外 | 手入力で代替 |
| U-03 | 足場工事シート | 未提出。計算定義不明 | manual_quote で手入力 |
| U-04 | 建材・副資材シート | 未提出。計算定義不明 | manual_quote で手入力 |
| U-05 | 設計本体費の原価含有確認 | 平松建築に確認が必要 | 現行計算のまま |
| U-06 | RIN住宅設備パッケージ金額 | Priority B シード | SHIN基準で暫定運用 |

---

## 顧客管理の位置づけ（Phase 1スコープ）

**判定: B案（簡易案）+ 将来拡張パス**

```
Phase 1: projects.customer_name (TEXT) / customer_name_2 (TEXT) ← 既存カラム活用
Phase 2: project_customers テーブル新規作成
         projects.customer_id (INTEGER, nullable) カラム追加
         既存データマイグレーション: customer_name → project_customers.name
```

**根拠**: Phase 1の目的は「原価計算の精度向上」。顧客管理は付随機能であり、独立テーブル化はスコープ肥大化を招く。

---

## 画面設計改訂概要（v3追加分）

### Phase 1 画面一覧（18画面）

| # | 画面ID | URL | 目的 | 対象ユーザー | 主要フィールド | 使用API | 影響テーブル | 権限 |
|---|--------|-----|------|-----------|-------------|---------|------------|------|
| 1 | LOGIN | `/login` | CF Access認証入口 | 全員 | メール入力 | (CF Access) | - | public |
| 2 | DASHBOARD | `/` | 案件一覧・状況把握 | 全ロール | サマリー4カード,案件テーブル,通知バナー | GET /projects, GET /master/changes/recent | R:projects,change_logs | 全ロール |
| 3 | PROJECT_NEW | `/projects/new` | 案件新規作成 | admin,mgr,est | 案件名,顧客名,lineup,面積,粗利率 | POST /projects | W:projects,audit_logs | admin,mgr,est |
| 4 | PROJECT_DETAIL | `/projects/:id` | 基本情報表示・編集 | 全ロール(閲覧) | 全基本情報フィールド,楽観ロック | GET/PUT /projects/:id | W:projects,audit_logs | 全(閲覧),admin/mgr/est(編集) |
| 5 | COST_OVERVIEW | `/projects/:id/costs` | 全37工種サマリー | 全ロール(閲覧) | 工種一覧,ステータスバッジ,計算実行ボタン,ジョブ状態 | GET /costs, POST /calculate, GET /status | W:snapshot_jobs | 全(閲覧),admin/mgr/est(計算) |
| 6 | COST_CATEGORY | `/projects/:id/costs/:categoryCode` | 工種内明細編集 | 全ロール(閲覧) | 明細テーブル,インライン編集,override_reason,review_status | GET /costs/:cc, PUT /costs/:itemId | W:items,summaries,audit_logs | 全(閲覧),admin/mgr/est(編集) |
| 7 | COST_SUMMARY | `/projects/:id/summary` | 原価集計・粗利率 | 全ロール(閲覧) | 3グループ表示,原価合計,粗利率,売価 | GET /summary, POST /sales-estimates | W:sales_estimates | 全(閲覧),admin/mgr/est(見積) |
| 8 | DIFF_REVIEW | `/projects/:id/diffs` | **v3新規** 再生成差分確認 | admin,mgr | diff一覧,diff_type色分け,is_significant,承認/却下 | GET /diffs, PUT /diffs/:id/accept | W:items,audit_logs | admin,mgr |
| 9 | WARNINGS | `/projects/:id/warnings` | **v3拡充** 警告一覧 | 全ロール(閲覧) | 警告テーブル,severity別フィルタ,解決ボタン | GET /warnings, PUT /resolve | W:warnings | 全(閲覧),admin/mgr/est(解決) |
| 10 | MASTER_CATEGORIES | `/master/categories` | 工種マスタ管理 | admin(編集) | 工種一覧,追加/編集フォーム | GET/POST/PUT /categories | W:categories,change_logs | admin(編集),全(閲覧) |
| 11 | MASTER_ITEMS | `/master/items` | 明細マスタ+バージョン管理 | admin(編集) | 明細一覧,バージョン履歴UI,追加/編集 | GET/POST/PUT /items, /versions | W:items,versions,change_logs | admin(編集),全(閲覧) |
| 12 | MASTER_PRODUCTS | `/master/products` | 商品カタログ管理 | admin(編集) | 商品一覧,追加/編集 | GET/POST/PUT /products | W:catalog,change_logs | admin(編集),全(閲覧) |
| 13 | MASTER_RULES | `/master/rules` | ルール閲覧(Phase 1) | 全ロール | ルール一覧,JSON条件表示 | GET /rules | R:rules | 全ロール |
| 14 | USER_MGMT | `/admin/users` | **v3新規** ユーザー管理 | admin | ユーザー一覧,追加,ロール変更,無効化 | GET/POST/PUT /users | W:app_users | admin |
| 15 | CHANGE_LOG | `/logs` | 変更履歴 | 全ロール | audit_logs+change_logsの時系列表示 | GET /logs | R:audit_logs,change_logs | 全ロール |
| 16 | SETTINGS | `/admin/settings` | **v3新規** システム設定 | admin | 設定一覧,閾値編集 | GET/PUT /settings | W:system_settings | admin |
| 17 | AI_CHECK (統合) | COST_OVERVIEW内 | AI条件チェック実行 | admin,mgr,est | 「AIチェック」ボタン,結果表示 | POST /ai/check-conditions | W:warnings | admin,mgr,est |
| 18 | ERROR_403 | `/403` | 未登録/無効ユーザー | - | 管理者への連絡案内 | - | - | public |

### 画面遷移図（v3改訂）

```
[CF Access] ──JWT──> [LOGIN/CALLBACK]
                        │
                     [app_users照合]
                        │
                     ┌──┴──┐
                  未登録  登録済
                     │       │
                 [ERROR_403] [DASHBOARD]
                                │
                    ┌───────────┼───────────────┐
                    │           │               │
                    ▼           ▼               ▼
             [PROJECT_NEW]  [案件選択]      [マスタ管理]
                    │           │               │
                    │           ▼               ├→ [MASTER_CATEGORIES]
                    │     [PROJECT_DETAIL]      ├→ [MASTER_ITEMS]
                    │           │               ├→ [MASTER_PRODUCTS]
                    │           ▼               ├→ [MASTER_RULES]
                    │     [COST_OVERVIEW]       └→ [CHANGE_LOG]
                    │       │      │
                    │   ┌───┼──────┤
                    │   │   │      │                [管理者メニュー]
                    │   ▼   ▼      ▼                │
                    │  [工種1][工種N] [WARNINGS]     ├→ [USER_MGMT]
                    │  (COST_CATEGORY)               └→ [SETTINGS]
                    │       │
                    │       ▼
                    │  [COST_SUMMARY]
                    │       │
                    │       ▼ (再生成後)
                    └→ [DIFF_REVIEW]
```

---

## 実装ステップ（v3 全面改訂）

### 全体構成

```
Phase 1-A: 基盤構築（4日）
  Step 0: 環境セットアップ + CI基盤
  Step 1: DB + Migration + Seed
  Step 2: 認証ミドルウェア + ユーザー管理

Phase 1-B: マスタ管理 + 案件管理（5日）
  Step 3: マスタ管理API + 画面
  Step 4: 案件CRUD + ダッシュボード

Phase 1-C: 計算エンジン + スナップショット（12日）★最重要
  Step 5: 計算エンジンコア（12種ハンドラー + ルール評価）
  Step 6: スナップショットジョブ（Queue + shadow snapshot）
  Step 7: 再生成 + diff生成

Phase 1-D: フロントエンド + 仕上げ（10日）
  Step 8: 原価一覧・工種詳細画面
  Step 9: 原価サマリー・売価見積・diff解決UI
  Step 10: 警告・変更履歴・AI条件チェック
  Step 11: 検証・仕上げ・ドキュメント最終化
```

### 並行可能性マトリクス

```
           Day: 1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
Step 0 (2d)     ██                                                        先行必須 (Prerequisite)
Step 1 (1d)        █                                                      → Step 0完了後
Step 2 (1d)           █                                                   → Step 1完了後

Step 3 (3d)              ███                                              → Step 2完了後
Step 4 (2d)                 ██                                            ← Step 3と並行可（後半）

Step 5 (6d)                    ██████                                     → Step 3完了後 ★クリティカルパス
Step 6 (3d)                          ███                                  → Step 5完了後
Step 7 (3d)                             ███                               → Step 6完了後

Step 8 (4d)                          ████                                 ← Step 6と並行可
Step 9 (3d)                                ███                            → Step 8 + Step 7 完了後
Step 10(2d)                                   ██                          ← Step 9と並行可
Step 11(1d)                                     █                         → 全Step完了後

クリティカルパス: 0(2) → 1(1) → 2(1) → 3(3) → 5(6) → 6(3) → 7(3) → 9(3) → 11(1) = 23日
並行パス最大圧縮: 26日（バッファ5日含む）
```

### タスク分類（前提 / 並行 / 後続）

```
┌──────────────────────────────────────────────────┐
│ 前提タスク（Prerequisite）                        │
│  B-01, B-02, B-03: seed JSON 修正                │
│  B-04: migration SQL 配置                        │
│  Step 0: 環境セットアップ                         │
│  Step 1: DB + Migration + Seed                   │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────┐
│ 並行可能タスク（Parallel）                        │
│  Step 3 & Step 4: マスタ管理+案件管理（後半並行）   │
│  Step 6 & Step 8: スナップショット+原価画面         │
│  Step 9 & Step 10: サマリー+警告（部分並行）        │
│  B-07: app_users admin 投入（Step 1完了で並行）    │
│  B-08: system_settings 確認（migration時に解決）   │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────┐
│ 後続タスク（Subsequent）                          │
│  Step 11: 検証・仕上げ（全Step完了後のみ）          │
│  本番デプロイ                                     │
│  ドキュメント最終化                               │
│  AI品質チェックガイドライン反映（入手次第）          │
└──────────────────────────────────────────────────┘
```

---

### Phase 1-A: 基盤構築（4日）

#### Step 0: 環境セットアップ + CI基盤（2日） — **完了 (2026-03-08)**

> **Step 0 Spike 結果: GO** — 9/9 テスト PASS。詳細は 19_STEP0_SPIKE_REPORT.md 参照。

```yaml
前提:
  - Cloudflare Account 作成済み
  - wrangler CLI インストール済み
  - Node.js 20+ 環境
  - B-01, B-02, B-03: seed JSON 修正着手（並行可能）

入力:
  - 12_MIGRATION_SQL_FINAL.md
  - 11_ENUM_STATUS_SPEC.md（Zod定義テンプレート）
  - wrangler.jsonc テンプレート

タスク:
  1. Hono + Cloudflare Pages プロジェクト初期化
     npm create -y hono@latest webapp -- --template cloudflare-pages --install --pm npm
  2. TypeScript + Zod + その他依存関係追加
  3. wrangler.jsonc 設定:
     - D1 binding (DB)
     - R2 binding (STORAGE)
     - Queue binding (SNAPSHOT_QUEUE)
     - compatibility_flags: ["nodejs_compat"]
  4. 11_ENUM_STATUS_SPEC.md セクション22 の全 Zod スキーマを src/schemas/enums.ts に実装
  5. ファイル構成骨格作成:
     src/
     ├── schemas/       # Zod バリデーション
     ├── middleware/     # auth.ts, rbac.ts
     ├── routes/         # API ルートハンドラー
     ├── engine/         # 計算エンジン
     │   ├── handlers/   # 12種ハンドラー
     │   └── ruleEvaluator.ts
     ├── services/       # ビジネスロジック
     │   └── openai/     # AI連携
     ├── utils/          # ユーティリティ
     └── types/          # TypeScript 型定義
  6. ecosystem.config.cjs 作成（PM2設定）
  7. Git init + .gitignore
  8. Cloudflare リソース作成:
     - D1 Database: npx wrangler d1 create hiramatsu-cost-production
     - R2 Bucket: npx wrangler r2 bucket create hiramatsu-cost-bucket
     - Queue: npx wrangler queues create SNAPSHOT_QUEUE
     - Pages Project: npx wrangler pages project create hiramatsu-cost
  9. CI スクリプト作成（package.json scripts）
  10. vite.config.ts 設定（Cloudflare Pages ビルド）

出力:
  - 動作する Hono プロジェクト（npm run build 成功）
  - wrangler pages dev dist が起動
  - 全 Zod スキーマが src/schemas/enums.ts に定義済み
  - Cloudflare リソースが作成済み

完了条件:
  □ npm run build 成功
  □ wrangler pages dev dist --ip 0.0.0.0 --port 3000 が起動
  □ curl http://localhost:3000/api/health → 200
  □ Zod スキーマが全enum値を網羅（11_ セクション22と完全一致）
  □ TypeScript コンパイルエラーなし
  □ Git初回コミット完了

検証方法:
  - TypeScript コンパイルエラーなし
  - /api/health が JSON レスポンスを返す
  - Zod enum値の数を 11_ENUM_STATUS_SPEC.md と照合

担当ロール: 開発者（AI + 人間レビュー）
依存先: なし（起点ステップ）
14_DEPENDENCY_MAP参照: セクション1-1 Step 1〜9
```

#### Step 1: DB + Migration + Seed（1日）

```yaml
前提:
  - Step 0 完了 + **GO 判定済み** (2026-03-08)
  - B-01, B-02, B-03 のシード修正完了（★実装前必須ブロッカー）
  - **CR-01**: 追加 migration (cost_inclusion_rules, lineup_option_groups) を Step 1 初日に実施
  - **CR-02**: project_cost_items.override_reason_category カラム追加
  - **CR-04**: Cloudflare Queue 本番テストを Step 1 の初期タスクに含む
  - B-04: migration SQL 準備完了（12_MIGRATION_SQL_FINAL.md）

入力:
  - 12_MIGRATION_SQL_FINAL.md → migrations/0001_initial_schema.sql
  - seed_categories_priority_a.json（修正済み）
  - seed_items_priority_a.json（修正済み: B-02, B-03）
  - seed_item_versions_priority_a.json
  - seed_rules_priority_a.json（修正済み: B-01）

タスク:
  1. migrations/0001_initial_schema.sql 配置（12_からコピー）
  2. マイグレーション適用:
     npx wrangler d1 migrations apply hiramatsu-cost-production --local
  3. scripts/import_seed_to_d1.ts 作成（05_MASTER_DATA_PLAN_v3.md 準拠）:
     - boolean → INTEGER (1/0) 変換
     - カラム名マッピング（current_unit_price → base_unit_price 等）
     - デフォルト値補完（rule_name=id, dates=NULL, is_active=1）
     - 全項目バリデーション（プレフィックス、一意性、参照整合性）
     - バッチ100件分割
     - --validate-only モード
  4. シードデータ投入実行
  5. app_users 初期 admin 投入（B-07）:
     INSERT INTO app_users (email, name, role, status) VALUES (?, ?, 'admin', 'active')
  6. 検証クエリ全実行
  7. seeds/admin_user.sql 作成（再投入用）

出力:
  - D1 に 25テーブル + 47インデックス
  - system_settings 9件（migration SQL内で投入済み）
  - cost_categories 10件
  - cost_master_items **58件**（v3.1確定: 旧記載49 → 実データ58）
  - cost_master_item_versions **58件**（v3.1確定: 旧記載49 → 実データ58）
  - cost_rule_conditions **47件**（v3.1確定: 旧記載54 → 実データ47）
  - app_users 1件（admin）

完了条件:
  □ SELECT COUNT(*) FROM sqlite_master WHERE type='table' → 25
  □ SELECT COUNT(*) FROM system_settings → 9
  □ SELECT COUNT(*) FROM cost_categories → 10
  □ SELECT COUNT(*) FROM cost_master_items → **58**
  □ SELECT COUNT(*) FROM cost_master_item_versions → **58**
  □ SELECT COUNT(*) FROM cost_rule_conditions → **47**
  □ SELECT COUNT(*) FROM app_users WHERE role='admin' → 1
  □ 参照整合性: 全rules の master_item_id が items に存在
  □ CHECK制約テスト: 不正 status INSERT → エラー

検証方法:
  - 上記SQL全実行
  - CHECK制約違反テスト（不正enum値INSERT）
  - import_seed_to_d1.ts --validate-only
  - 14_DEPENDENCY_MAP セクション2 のレイヤー順序確認

担当ロール: 開発者
依存先: Step 0, B-01/B-02/B-03 解消
14_DEPENDENCY_MAP参照: セクション1-1 Step 10〜13, セクション3-2
```

#### Step 2: 認証ミドルウェア + ユーザー管理（1日）

```yaml
前提:
  - Step 1 完了（app_users に admin レコード存在）
  - Cloudflare Access Application 基本設定済み（or DEV_USER_EMAIL バイパス）

入力:
  - 11_ENUM_STATUS_SPEC.md セクション10（role, status）
  - 11_ENUM_STATUS_SPEC.md セクション23（権限マトリクス）
  - 14_DEPENDENCY_MAP.md セクション3-1（認証フロー）

タスク:
  1. src/middleware/auth.ts:
     - CF-Access-Authenticated-User-Email ヘッダー取得
     - (開発環境) DEV_USER_EMAIL フォールバック
     - app_users テーブル照合
     - last_login_at 更新
     - c.set('user', { id, email, role, name }) 設定
     - 未登録/inactive → 403
  2. src/middleware/rbac.ts:
     - requireRole('admin'), requireRole('admin','manager') 等のヘルパー
     - ルート定義ごとの role チェック
  3. ユーザー管理 API (5エンドポイント):
     - GET /api/users → admin
     - POST /api/users → admin（email重複チェック付き）
     - PUT /api/users/:id → admin
     - POST /api/users/:id/deactivate → admin
     - GET /api/users/me → 全ロール
  4. .dev.vars 設定: DEV_USER_EMAIL=admin@hiramatsu.example.com
  5. エラーページ雛形: 403用（「管理者に連絡してください」）

出力:
  - 認証ミドルウェア (auth.ts + rbac.ts)
  - ユーザー管理 API 5エンドポイント
  - 開発環境用バイパス
  - 403エラーページ

完了条件:
  □ 未認証リクエスト → 401/403
  □ 未登録メール → 403
  □ viewer が POST /api/projects → 403
  □ admin が GET /api/users → 200（ユーザー一覧）
  □ admin が POST /api/users → 201（新ユーザー作成）
  □ email重複 → 409
  □ GET /api/users/me → 自分の情報返却
  □ deactivate後のログイン → 403

検証方法:
  - curl テスト（DEV_USER_EMAIL バイパス使用）
  - 各ロール×主要操作の権限テスト

担当ロール: 開発者
依存先: Step 1
14_DEPENDENCY_MAP参照: セクション3-1, セクション6（権限マトリクス）
```

---

### Phase 1-B: マスタ管理 + 案件管理（5日）

#### Step 3: マスタ管理 API + 画面（3日）

```yaml
前提:
  - Step 2 完了（認証ミドルウェア動作）
  - シードデータ投入済み（10工種、**58明細**、**47ルール**）（v3.1確定）

入力:
  - 01_DB_SCHEMA_DESIGN_v4.md（テーブル2〜9）
  - 03_SCREEN_DESIGN_v3.md（MASTER_* 画面）
  - 05_MASTER_DATA_PLAN_v3.md（シード構造・バリデーション仕様）

タスク:
  1. マスタ管理 API (16エンドポイント):
     - 工種: GET/POST/PUT /api/master/categories
     - 明細: GET/POST/PUT /api/master/items
     - バージョン: GET/POST /api/master/items/:id/versions, /current
     - ルール: GET /api/master/rules
     - 商品: GET/POST/PUT /api/master/products
     - 変更履歴: GET /api/master/logs
     - 変更通知: GET /api/master/changes/recent, /affected-projects
  2. master_change_logs 自動記録（全マスタ書込操作時にTX内でINSERT）
  3. マスタ管理画面（4画面）:
     - MASTER_CATEGORIES: 工種一覧テーブル + 追加/編集モーダル
     - MASTER_ITEMS: 明細一覧 + フィルタ(category_code) + バージョン管理UI
       - 明細詳細: 有効バージョン表示、バージョン追加フォーム
     - MASTER_RULES: ルール一覧（閲覧のみ Phase 1。JSON条件の視覚化表示）
     - MASTER_PRODUCTS: 商品一覧 + 追加/編集フォーム
  4. マスタ変更通知バナー（ダッシュボード用コンポーネント）

出力:
  - マスタ管理 API 16エンドポイント
  - マスタ管理画面 4画面
  - 変更履歴の自動記録
  - 変更通知バナーコンポーネント

完了条件:
  □ GET /api/master/categories → 10件（Priority A）
  □ GET /api/master/items?category_code=foundation → 基礎工事の明細一覧
  □ POST /api/master/items/:id/versions → 新バージョン作成 + master_change_logs記録
  □ GET /api/master/changes/recent → 直近変更一覧
  □ 画面から工種一覧が表示・操作可能
  □ 全マスタ書込操作が master_change_logs に記録
  □ 権限チェック: admin以外の POST/PUT → 403

検証方法:
  - API レスポンスのJSON構造・件数検証
  - master_change_logs のINSERT確認
  - 画面操作テスト

担当ロール: 開発者
依存先: Step 2
14_DEPENDENCY_MAP参照: セクション3-4-3（マスタ管理API）
```

#### Step 4: 案件CRUD + ダッシュボード（2日）

```yaml
前提:
  - Step 3 完了（並行可能: Step 3 後半と同時進行可）
  - マスタデータ存在（工種・明細の参照用）

入力:
  - 01_DB_SCHEMA_DESIGN_v4.md（projects テーブル）
  - 03_SCREEN_DESIGN_v3.md（DASHBOARD, PROJECT_NEW, PROJECT_DETAIL）

タスク:
  1. 案件 CRUD API (5エンドポイント):
     - POST /api/projects（案件コード自動採番 YYYY-NNN）
     - GET /api/projects（ページネーション、フィルタ、検索、担当者）
     - GET /api/projects/:id
     - PUT /api/projects/:id（楽観ロック: version チェック）
     - POST /api/projects/:id/archive
  2. 案件コード自動採番ロジック:
     - SELECT MAX(CAST(SUBSTR(project_code, 6) AS INTEGER)) FROM projects
       WHERE project_code LIKE 'YYYY-%'
     - 重複時のリトライ（最大3回）
  3. project_audit_logs 自動記録（全案件操作時）
  4. ダッシュボード画面:
     - サマリーカード4枚（進行中/要確認/今月完了/平均粗利率）
     - マスタ変更通知バナー（Step 3のコンポーネント使用）
     - 案件一覧テーブル（フィルタ/検索/ページネーション/ソート）
  5. 案件新規作成画面:
     - 基本情報（案件名、顧客名、顧客名2、建築地）
     - ラインナップ選択（SHIN/RIN/MOKU_OOYANE/MOKU_HIRAYA/MOKU_ROKU）
     - 面積・寸法入力（tsubo, building_area_m2, 各面積フィールド）
     - 粗利率設定（standard/solar/option 各初期値は system_settings から取得）
     - 建物特性フラグ（各 INTEGER チェックボックス）
  6. 案件詳細画面:
     - 基本情報表示・編集（全フィールド）
     - 楽観ロック衝突UI（409 → 「データが更新されました。リロードしてください」ダイアログ）
     - 原価一覧への遷移ボタン

出力:
  - 案件 CRUD API 5エンドポイント
  - ダッシュボード画面
  - 案件作成・詳細画面
  - 楽観ロック機能
  - 監査ログ自動記録

完了条件:
  □ POST /api/projects → 案件作成 + YYYY-NNN 自動採番
  □ GET /api/projects?status=draft&lineup=SHIN → フィルタ動作
  □ PUT /api/projects/:id + version=1 → 200（更新成功、version→2）
  □ PUT /api/projects/:id + version=0 → 409（楽観ロック衝突）
  □ ダッシュボードに案件一覧が表示
  □ 全操作が project_audit_logs に記録
  □ 粗利率デフォルト値が system_settings から取得される

検証方法:
  - 楽観ロック衝突テスト（2リクエスト同時送信）
  - 案件コード採番の連番テスト（年跨ぎ含む）
  - ダッシュボード表示+フィルタテスト

担当ロール: 開発者
依存先: Step 3（部分的に並行可能）
14_DEPENDENCY_MAP参照: セクション3-4-4（案件管理API）
```

---

### Phase 1-C: 計算エンジン + スナップショット（12日）★最重要

#### Step 5: 計算エンジンコア（6日）

```yaml
前提:
  - Step 3 完了（マスタデータ参照可能）
  - 02_COST_CALCULATION_DEFINITIONS_v2.md 精読完了

入力:
  - 02_COST_CALCULATION_DEFINITIONS_v2.md（37工種の計算定義）
  - 01_DB_SCHEMA_DESIGN_v4.md（テーブル構造）
  - 11_ENUM_STATUS_SPEC.md セクション21（型変換仕様）
  - 05_MASTER_DATA_PLAN_v3.md（シードデータ構造）

タスク:
  1. 12種類の計算ハンドラー実装（src/engine/handlers/）:
     | ハンドラー | ロジック | 金額カラム参照 |
     |-----------|---------|-------------|
     | fixed_amount | base_fixed_amount をそのまま使用 | base_fixed_amount |
     | per_tsubo | tsubo × base_unit_price | base_unit_price |
     | per_m2 | quantity_reference_field × base_unit_price | base_unit_price |
     | per_meter | 参照長さ × base_unit_price | base_unit_price |
     | per_piece | 個数 × base_unit_price | base_unit_price |
     | range_lookup | conditions_json 範囲条件で明細選択+金額決定 | actions_json |
     | lineup_fixed | lineup値で固定額決定 | conditions_json |
     | rule_lookup | conditions_json+actions_json で数量算出 | actions_json |
     | manual_quote | auto_*は空、手入力前提 | - |
     | product_selection | product_catalog から商品選択 | catalog.unit_price |
     | package_with_delta | 標準数量×単価, is_shizuoka_prefecture県内/県外排他 | base_unit_price |
     | threshold_surcharge | 基準超過分を計算 | conditions_json |

  2. JSON ルール評価エンジン（src/engine/ruleEvaluator.ts）:
     - 型変換: boolean→INTEGER(1/0), string→TEXT, number→REAL
     - 9演算子: =, !=, >, >=, <, <=, in, not_in, between
     - 9アクション: select, deselect, set_quantity, set_fixed_amount,
       set_unit_price, set_reference_field, flag_manual_confirmation,
       show_warning, add_amount

  3. 2パス計算ロジック（src/engine/calculator.ts）:
     - 第1パス: 全工種を独立計算（rule_group != 'cross_category'）
     - 第2パス: rule_group='cross_category' ルール評価（例: 焼杉→木工事加算）

  4. final_* 算出ロジック（01_v4 T-01 準拠）:
     - final_quantity = manual_quantity ?? auto_quantity
     - final_unit_price = manual_unit_price ?? auto_unit_price
     - final_amount = manual_amount ??
         (manual値ありなら final_quantity × final_unit_price) ??
         (fixed系なら auto_fixed_amount) ??
         auto_amount

  5. D1バッチ分割ユーティリティ（src/utils/d1Batch.ts）:
     - 100件制限対応
     - フォールバック個別INSERT（バッチ失敗時）

  6. ユニットテスト（各ハンドラー + ルール評価器）:
     - 02_v2 の具体金額による正確性テスト
     - 型変換テスト（boolean/string/number → DB型）
     - between 演算子の境界値テスト（[min, max) 半開区間）

出力:
  - 計算エンジン（12ハンドラー + ルール評価器 + 2パスロジック + final_*算出）
  - D1バッチユーティリティ
  - ユニットテスト一式

完了条件:
  □ 12種計算ハンドラーが全てテスト通過
  □ ルール評価器が9演算子 × 型変換をテスト通過
  □ 2パス計算で cross_category ルールが発火
  □ final_* 算出ロジックが T-01 仕様通り
  □ テストケース4パターン:
    - SHIN/35坪/等級5/県内 → 基礎・木工事・断熱の金額一致
    - RIN/42坪/等級6/県内 → RIN加算含む金額一致
    - MOKU_HIRAYA/28坪/等級5/県外 → MOKU平屋金額一致
    - MOKU_OOYANE/30坪/等級6/県外 → MOKU大屋根金額一致

検証方法:
  - ユニットテスト全通過
  - 4パターンのスプレッドシート突合

担当ロール: 開発者（最重要・最大工数）
依存先: Step 3
14_DEPENDENCY_MAP参照: セクション4-1（計算フロー DAG）
```

#### Step 6: スナップショットジョブ（3日）

```yaml
前提:
  - Step 5 完了（計算エンジン動作確認済み）
  - Cloudflare Queue 作成済み（Step 0）

入力:
  - 14_DEPENDENCY_MAP.md セクション4-1（計算フロー DAG）
  - 01_DB_SCHEMA_DESIGN_v4.md（cost_snapshot_jobs, project_cost_snapshots）
  - 11_ENUM_STATUS_SPEC.md セクション11, 12（job_type, job_status, snapshot_status）

タスク:
  1. POST /api/projects/:id/calculate:
     - 排他チェック: SELECT COUNT(*) WHERE status IN ('queued','running')
     - cost_snapshot_jobs INSERT (status='queued', job_type, triggered_by)
     - SNAPSHOT_QUEUE.send({ job_id })
     - return 202 Accepted { job_id }

  2. GET /api/projects/:id/calculate/status:
     - cost_snapshot_jobs.status + progress情報 返却

  3. Queue Consumer (src/services/snapshotJobProcessor.ts):
     - TX-1: job.status → 'running', started_at = now()
     - READ: projects 条件, master_items + versions + rules
     - COMPUTE: 計算エンジン呼出し
     - TX-2: shadow snapshot 生成
       a. project_cost_snapshots INSERT (status='active')
       b. project_cost_items INSERT（バッチ100件分割）
       c. project_cost_summaries UPSERT
       d. project_warnings INSERT
       e. 旧 snapshot.status → 'superseded'
       f. projects.current_snapshot_id = 新ID
       g. projects.revision_no += 1
     - POST: 売価乖離チェック（system_settings 閾値参照）
     - TX-3: job.status → 'completed', result_snapshot_id, duration_ms

  4. 失敗ハンドリング:
     - CATCH → job.status='failed', error_message, error_detail_json
     - 旧snapshot は一切変更なし（安全ロールバック）

  5. wrangler.jsonc に Queue Consumer 設定追加

出力:
  - 計算実行API（非同期 202 Accepted）
  - Queue Consumer（shadow snapshot 生成）
  - 売価乖離警告の自動評価

完了条件:
  □ POST /api/projects/:id/calculate → 202 + job_id
  □ 同一案件に二重ジョブ → 409
  □ Queue Consumer が snapshot 生成完了
  □ projects.current_snapshot_id が更新
  □ projects.revision_no がインクリメント
  □ project_cost_items に明細が生成
  □ project_cost_summaries に工種集計が生成
  □ project_warnings に警告が生成
  □ 売価乖離率超過時に sales_estimate_gap warning INSERT
  □ 失敗時: job.status='failed', 旧snapshot維持

検証方法:
  - calculate → ポーリング → 結果確認の一連フロー
  - 排他制御テスト（同時2リクエスト）
  - 意図的エラーによる失敗ハンドリングテスト

担当ロール: 開発者
依存先: Step 5
14_DEPENDENCY_MAP参照: セクション3-4-5, セクション4-1（Queue Consumer詳細）
```

#### Step 7: 再生成 + diff生成（3日）

```yaml
前提:
  - Step 6 完了（初回スナップショット生成可能）

入力:
  - 01_DB_SCHEMA_DESIGN_v4.md（project_cost_regeneration_diffs）
  - 11_ENUM_STATUS_SPEC.md セクション13（diff_type 7値）
  - 14_DEPENDENCY_MAP.md セクション4-2（再生成フロー）

タスク:
  1. POST /api/projects/:id/recalculate:
     - job_type: regenerate_preserve_reviewed / regenerate_auto_only / regenerate_replace_all
     - 排他チェック + Queue enqueue

  2. POST /api/projects/:id/recalculate/:categoryCode:
     - target_categories_json = [categoryCode]

  3. 再生成 Queue Consumer 拡張:
     a. 旧 snapshot items 読込（current_snapshot_id → items）
     b. 新計算実行
     c. diff 計算:
        - 旧 items vs 新 items を item_name/master_item_id で照合
        - diff_type 判定（7種: amount_changed, quantity_changed,
          unit_price_changed, fixed_amount_changed, selection_changed,
          item_added, item_removed）
        - change_amount = new - old
        - change_percent = (new - old) / old × 100
        - is_significant = (abs(change_percent) > system_settings threshold)
     d. 保持ルール適用:
        - preserve_reviewed: review_status='confirmed' → 旧値維持
        - auto_only: manual_* 設定済み → 旧値維持
        - replace_all: 全items 白紙再計算
     e. project_cost_regeneration_diffs INSERT

  4. diff 参照 API:
     - GET /api/projects/:id/diffs?job_id=&is_significant=&category_code=

  5. diff 承認 API:
     - PUT /api/projects/:id/diffs/:diffId/accept
     - 承認 → 該当 item の値を確定（review_status='confirmed'）

  6. 一括承認 API:
     - PUT /api/projects/:id/diffs/accept-all?job_id=

出力:
  - 再生成 API（3種 job_type 対応）
  - diff 生成ロジック（7種 diff_type）
  - diff 参照・承認・一括承認 API

完了条件:
  □ 再生成で旧 snapshot → superseded
  □ preserve_reviewed: confirmed items の final_amount 不変
  □ auto_only: manual_* 設定済み items が保持
  □ replace_all: 全items が再計算
  □ diff が正しく7種生成される
  □ change_amount, change_percent が正確
  □ is_significant が system_settings 閾値で正しく判定
  □ diff 承認で items が confirmed

検証方法:
  - 初回計算 → 条件変更 → 再生成 → diff確認の一連フロー
  - 3種 job_type それぞれの保持ルールテスト
  - diff の数値正確性テスト

担当ロール: 開発者
依存先: Step 6
14_DEPENDENCY_MAP参照: セクション4-2（再生成フロー）
```

---

### Phase 1-D: フロントエンド + 仕上げ（10日）

#### Step 8: 原価一覧・工種詳細画面（4日）

```yaml
前提:
  - Step 6 完了（スナップショット生成可能）
  - Step 4 完了（案件CRUD動作）
  - ※ Step 6と並行可能（API未完了でもモック使用）

入力:
  - 03_SCREEN_DESIGN_v3.md（COST_OVERVIEW, COST_CATEGORY）
  - 14_DEPENDENCY_MAP.md セクション3-3（画面レイヤー）

タスク:
  1. COST_OVERVIEW 画面:
     - 全37工種のサマリー表示（ステータスバッジ: pending/confirmed/needs_review/flagged）
     - 3グループ分類（standard/solar/option）のタブ or セクション
     - 「原価計算実行」ボタン → POST /calculate → 202
     - ジョブ状態ポーリング（2秒間隔、queued→running→completed）
     - 完了時の自動リフレッシュ
     - 「AIチェック実行」ボタン（Step 10で実装、UIスロットのみ配置）
     - 警告件数バッジ
  2. COST_CATEGORY 画面:
     - 工種内の明細一覧テーブル（is_selected, item_name, auto_*, manual_*, final_*, review_status）
     - インライン編集（manual_quantity, manual_unit_price, manual_amount）
     - override_reason 必須バリデーション（manual値変更時）
     - review_status 状態遷移ボタン（pending→confirmed, needs_review→confirmed 等）
     - 楽観ロック衝突 UI（409 → リロード促進ダイアログ）
     - 工種サマリーヘッダー（工種名、原価合計、明細数、確認済み数）
  3. ログイン後の初期導線:
     - CF Access JWT → /api/users/me 呼出し
     - 登録済み → DASHBOARD リダイレクト
     - 未登録 → ERROR_403 ページ表示
  4. 共通ヘッダー/ナビゲーション:
     - ユーザー名表示
     - ロール表示
     - ナビゲーションメニュー（ダッシュボード/マスタ管理/管理者メニュー）

出力:
  - COST_OVERVIEW 画面
  - COST_CATEGORY 画面（インライン編集対応）
  - ログイン導線
  - 共通ヘッダー/ナビゲーション

完了条件:
  □ 全37工種がサマリー表示される
  □ 計算実行ボタンで非同期ジョブが投入される
  □ ポーリングで完了後に画面が更新される
  □ 明細の手修正が保存される
  □ override_reason なしの保存が拒否される
  □ 楽観ロック衝突でダイアログ表示
  □ review_status の状態遷移が正しい
  □ ログイン後にダッシュボードに到達

検証方法:
  - 案件作成→計算実行→結果表示の一連フロー
  - 手修正操作テスト
  - 楽観ロック衝突テスト（2タブ同時編集）

担当ロール: 開発者
依存先: Step 6（並行可能部分あり）
14_DEPENDENCY_MAP参照: セクション3-3（画面レイヤー COST_OVERVIEW, COST_CATEGORY）
```

#### Step 9: 原価サマリー・売価見積・diff解決UI・ユーザー管理画面（3日）

```yaml
前提:
  - Step 8 完了
  - Step 7 完了（再生成・diff動作）

入力:
  - 03_SCREEN_DESIGN_v3.md（COST_SUMMARY）
  - 01_DB_SCHEMA_DESIGN_v4.md（project_sales_estimates, project_cost_regeneration_diffs）

タスク:
  1. COST_SUMMARY 画面:
     - 3グループ表示（標準/太陽光/オプション）
     - 各グループ: 原価合計、粗利率、売価
     - 売価計算: 売価 = 原価 ÷ (1 - 粗利率/100)
     - 総合計の表示
  2. 売価見積保存:
     - POST /api/projects/:id/sales-estimates
     - estimate_type='internal', snapshot_id紐付け
     - 保存成功メッセージ
  3. DIFF_REVIEW 画面（v3新規）:
     - 再生成後の差分一覧テーブル
     - diff_type ごとの色分け表示
     - is_significant フラグ（赤ハイライト）
     - change_amount, change_percent 表示
     - 差分承認/却下ボタン（個別）
     - 一括承認ボタン（is_significant のみ or 全件）
     - フィルタ: category_code, diff_type, is_significant
  4. USER_MGMT 画面（v3新規）:
     - ユーザー一覧テーブル（email, name, role, status, last_login_at）
     - 追加フォーム（email, name, role, department）
     - ロール変更ドロップダウン（admin/manager/estimator/viewer）
     - 無効化ボタン（確認ダイアログ付き）
     - admin のみアクセス可能

出力:
  - COST_SUMMARY 画面
  - 売価見積保存機能
  - DIFF_REVIEW 画面
  - USER_MGMT 画面

完了条件:
  □ 3グループの原価合計・粗利率・売価が正しく表示
  □ 売価見積が保存される
  □ diff一覧が正しく表示される（7種 diff_type 色分け）
  □ diff承認で items が confirmed
  □ 一括承認が動作
  □ ユーザー一覧が表示
  □ ユーザー追加・ロール変更・無効化が動作
  □ admin以外が /admin/users → リダイレクト or 403

検証方法:
  - サマリー金額の手計算照合
  - diff承認フローテスト
  - ユーザー管理操作テスト

担当ロール: 開発者
依存先: Step 8, Step 7
14_DEPENDENCY_MAP参照: セクション3-3, 3-4-7（画面+API）
```

#### Step 10: 警告・変更履歴・AI条件チェック・システム設定（2日）

```yaml
前提:
  - Step 9 完了（並行可能部分あり）
  - OPENAI_API_KEY 設定済み（wrangler secret or .dev.vars）

入力:
  - 04_OPENAI_API_DESIGN.md（機能B: 条件漏れチェック）
  - 01_DB_SCHEMA_DESIGN_v4.md（project_warnings, project_audit_logs, master_change_logs）

タスク:
  1. WARNINGS 画面（拡充版）:
     - 案件内の警告一覧テーブル
     - severity別フィルタ（info/warning/error）
     - warning_type別フィルタ
     - 警告解決ボタン + resolved_note 入力モーダル
     - 未解決件数バッジ
  2. CHANGE_LOG 画面:
     - project_audit_logs（案件変更履歴）+ master_change_logs（マスタ変更履歴）の統合表示
     - フィルタ（target_type, action, date_range）
     - 時系列ソート
  3. AI 条件チェック機能:
     - POST /api/ai/check-conditions
     - 案件条件 + 採用明細を構造化 → OpenAI Responses API 送信
     - 構造化出力（json_schema） → project_warnings に保存
     - COST_OVERVIEW 画面の「AIチェック実行」ボタン接続
     - 結果表示（severity別警告一覧）
  4. SETTINGS 画面（v3新規、簡易版）:
     - system_settings の一覧テーブル（setting_key, setting_value, description）
     - 値の編集フォーム（setting_type に応じた入力UI）
     - admin のみアクセス可能

出力:
  - WARNINGS 画面（拡充版）
  - CHANGE_LOG 画面
  - AI条件チェック機能
  - SETTINGS 画面

完了条件:
  □ 警告一覧が表示・フィルタ動作
  □ 警告解決が保存（resolved_by, resolved_at, resolved_note）
  □ 変更履歴が時系列で正しく表示
  □ AI条件チェックで warning が生成される
  □ AIチェック結果が severity 別に表示
  □ system_settings の閲覧・編集が可能
  □ admin以外が /admin/settings → 403

検証方法:
  - 警告操作テスト
  - AI チェック結果の妥当性確認（既知パターンでの検証）
  - 設定変更テスト（閾値変更→再計算→警告挙動変化）

担当ロール: 開発者
依存先: Step 9（部分並行可能）
14_DEPENDENCY_MAP参照: セクション3-4-8（AI・設定API）
```

#### Step 11: 検証・仕上げ・ドキュメント最終化（1日）

```yaml
前提:
  - Step 8〜10 全完了

入力:
  - 05_MASTER_DATA_PLAN_v3.md 検証パターン
  - 02_COST_CALCULATION_DEFINITIONS_v2.md 全37工種
  - スプレッドシート実データ

タスク:
  1. テスト案件4パターンの突合検証:
     - SHIN / 35坪 / 等級5 / 県内
     - RIN / 42坪 / 等級6 / 県内
     - MOKU_HIRAYA / 28坪 / 等級5 / 県外
     - MOKU_OOYANE / 30坪 / 等級6 / 県外
  2. ルール発火テスト（12計算パターン × 主要条件分岐）
  3. 全18画面操作テスト
  4. 権限テスト（4ロール × 主要操作）
  5. 楽観ロック衝突テスト（案件/明細それぞれ）
  6. 再生成 → diff → 承認 の一連フローテスト
  7. デプロイ & 本番環境検証:
     - npm run build
     - wrangler d1 migrations apply（本番）
     - wrangler pages deploy dist
     - 本番でのヘルスチェック + 基本操作テスト
  8. ドキュメント最終化:
     - README.md 更新
     - 全ドキュメントのバージョン確認
     - デプロイ手順書
     - 08_OPERATIONAL_RUNBOOK.md との整合性確認

出力:
  - テスト結果レポート
  - 本番デプロイ完了
  - 最終ドキュメント

完了条件:
  □ テスト案件4パターンでスプレッドシートと数字一致
  □ 全12ルールパターンが正常発火
  □ 全18画面が正常動作
  □ 4ロールの権限が正しく動作
  □ 楽観ロック衝突が正しく409を返す
  □ 再生成→diff→承認フローが完走
  □ 本番環境で /api/health → 200
  □ 本番環境で案件作成→計算→結果表示の一連フロー動作

検証方法:
  - 突合レポート作成（スプレッドシート vs システム、工種別）
  - 本番環境テスト
  - PM/オーナーレビュー

担当ロール: 開発者 + PM/オーナーレビュー
依存先: 全Step完了
14_DEPENDENCY_MAP参照: 全セクション
```

---

## 全体スケジュール概算（v3）

| Phase | Step | 内容 | 日数(v2) | 日数(v3) | 差分理由 |
|-------|------|------|----------|----------|---------|
| 1-A | 0 | 環境セットアップ+CI | 1-2日 | **2日** | Queue+認証+Zod準備追加 |
| 1-A | 1 | DB+Migration+Seed | 1日 | **1日** | 12_準備済み |
| 1-A | 2 | 認証+ユーザー管理 | - | **1日** | **v3新規** |
| 1-B | 3 | マスタ管理API+画面 | 3-4日 | **3日** | バージョン管理含む |
| 1-B | 4 | 案件CRUD+ダッシュボード | 2-3日 | **2日** | 自動採番+楽観ロック |
| 1-C | 5 | 計算エンジンコア | 5-7日 | **6日** | 12ハンドラー+ルール評価+2パス |
| 1-C | 6 | スナップショットジョブ | - | **3日** | **v3新規**: Queue+shadow snapshot |
| 1-C | 7 | 再生成+diff | - | **3日** | **v3新規**: 3種job_type+diff |
| 1-D | 8 | 原価一覧・工種詳細 | 3-4日 | **4日** | ポーリング+非同期対応 |
| 1-D | 9 | サマリー・売価・diff解決・ユーザーUI | 1-2日 | **3日** | diff解決UI+ユーザー管理UI |
| 1-D | 10 | 警告・履歴・AIチェック・設定 | 2-3日 | **2日** | AI条件チェック+設定画面 |
| 1-D | 11 | 検証・仕上げ | 2-3日 | **1日** | 集約テスト+本番デプロイ |
| | | **合計** | 28-39日 | **31日** | 明確化により範囲確定 |

**クリティカルパス: 23日** + バッファ3日 = **26日（最短目標）**
Step 0(2) → 1(1) → 2(1) → 3(3) → 5(6) → 6(3) → 7(3) → 9(3) → 11(1)

---

## リスクと対策（v3）

| # | リスク | 発生確率 | 影響度 | 対策 |
|---|--------|---------|--------|------|
| R-01 | 計算ロジック不明（足場・建材シート未提出） | 確定 | 中 | manual_quote で手入力対応。Phase 1スコープから自動計算除外 |
| R-02 | Cloudflare Queue のレイテンシ | 低 | 低 | 202即返+ポーリング。タイムアウト設定必須（60秒） |
| R-03 | D1バッチ100件制限でTX失敗 | 中 | 中 | バッチ分割+フォールバック個別INSERT |
| R-04 | スプレッドシートとの数字不一致 | 中 | 高 | Step 11で4パターン突合。差異は1件ずつ原因特定 |
| R-05 | Queue Consumer のCPU時間制限(30ms paid) | 低 | 中 | 大規模案件は target_categories_json で工種分割 |
| R-06 | CF Access設定不備 | 中 | 低 | DEV_USER_EMAIL バイパスで先行。本番は別途設定 |
| R-07 | shadow snapshot TX失敗（大量行） | 低 | 高 | 失敗→job=failed, 旧snapshot維持。リトライ可能設計 |
| R-08 | AI品質チェックガイドライン未適用 | 確定 | 低 | 一般品質原則で進行。入手次第差分反映 |
| R-09 | OpenAI API レイテンシ/障害 | 低 | 低 | AIチェックはオプショナル。障害時はスキップ可能 |
| R-10 | 同時編集頻度が高い場合の楽観ロック衝突多発 | 低 | 中 | 5〜10名規模では低確率。system_settings で衝突監視閾値設定済み |

---

## 成功基準（v3 — 15項目）

Phase 1 が「完成」と言える条件:

1. **全37工種の原価入力が可能**（自動/半自動/手動のいずれかで）
2. **Priority A工種17種が自動計算可能**（うち10種はシードデータ完備）
3. **テスト案件4パターンでスプレッドシートと数字が一致**
4. **手修正時に理由が記録される**（override_reason 必須バリデーション）
5. **条件漏れ警告が表示される**（ルールエンジン + AI条件チェック）
6. **マスタ変更・案件変更の履歴が残る**（バージョン管理含む）
7. **粗利率・想定売価がサマリーで見える**（3グループ: 標準/太陽光/オプション）
8. **楽観ロックが機能する**（同時編集時に409エラー）
9. **案件コードが自動採番される**（YYYY-NNN フォーマット）
10. **スプレッドシート5フィールドが完全に保持されている**
11. **スナップショットジョブが非同期で動作し、revision_noが正しくインクリメント**
12. **再生成で3種のjob_typeが正しく動作し、diff（7種diff_type）が生成される**
13. **CF Access + app_users で4ロールのアクセス制御が動作**
14. **ユーザー管理（一覧・追加・ロール変更・無効化）が動作**
15. **売価乖離警告が system_settings の閾値に基づいて自動生成される**

---

## Phase 2以降の拡張要件（実装スコープ外）

### Phase 2: 運用改善・顧客管理

| 機能 | 関連テーブル | v4での準備状態 |
|------|-------------|--------------|
| project_customers 独立テーブル | 新規 | Phase 1は projects.customer_name で代替 |
| 顧客管理画面（CRM的） | project_customers | 新規 |
| lineup_packages 複合パッケージ | lineup_packages | テーブル作成済み、データ未投入 |
| AI PDF読取（機能A） | project_input_sources | テーブル作成済み、API未実装 |
| 外部参照管理 | external_references | テーブル作成済み、API未実装 |
| 見積比較画面 | project_sales_estimates | テーブル作成済み、比較UI未実装 |
| ルール管理画面（編集機能） | cost_rule_conditions | Phase 1は閲覧のみ |
| 地域ルール管理画面 | area_rules | テーブル作成済み、管理UI未実装 |

### Phase 3: 分析・実績管理

| 機能 | テーブル | 備考 |
|------|---------|------|
| 実績原価CSV取込 | project_actual_costs（新規） | Phase 3 migration追加 |
| 実績原価集計 | project_actual_summaries（新規） | 同上 |
| 原価差異分析 | project_cost_variance（新規） | 同上 |
| KPIダッシュボード | 既存テーブル | 集計クエリ+分析UI |

### Phase 4: 外部連携

| 機能 | 連携先 | 備考 |
|------|--------|------|
| ANDPAD原価入力 | ANDPAD API | 案件マッピングテーブル新規 |
| 材料発注書PDF | PDF生成→R2 | Workers対応PDF生成 |
| 案件進捗管理 | 外部ツール | Webhook受信 |
| 商談シート連携 | スプレッドシート | sales_estimates活用 |

---

*最終更新: 2026-03-08*
*改訂番号: v3.2（v3.1 + Priority A 実データ件数確定: items/versions 49→58, rules 54→47。シード生成・D1投入・検証により確定した実数値に全ドキュメントを統一）*
*AI品質チェックガイドライン: 未入手・後追い反映*
*Step 0 スパイクレポート: 19_STEP0_SPIKE_REPORT.md 参照*
