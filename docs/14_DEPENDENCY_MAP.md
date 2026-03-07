# 全体依存関係マップ v2（DAG構造・包括版）

> **目的**: 画面・API・D1テーブル・Queue Job・Cloudflare Access・OpenAI API・seed/migration/import・将来連携の依存関係を、前提・入力・出力・更新対象・トランザクション境界・非同期/同期・権限まで**DAG（有向非巡回グラフ）**として明示する。  
> **方針**: 実装は行わない。計画の精緻化のみ。  
> **AI品質チェックガイドライン**: 未入手。入手次第差分反映。現時点では型安全・テスト駆動・ドキュメント整合性・コードレビュー可能性を基準とする。

---

## 0. 凡例

| 記号 | 意味 |
|------|------|
| `→` | 依存（右が先に必要） |
| `⇄` | 双方向参照 |
| `[SYNC]` | 同期処理 |
| `[ASYNC]` | 非同期処理（Queue Job） |
| `[TX]` | トランザクション必須 |
| `🔒` | 権限制御あり |
| `⚠️` | 循環参照/特殊対応 |
| `🟢` | 起点（前提なし） |
| `🔴` | 終端（下流なし） |
| `🔵` | 中間ノード |

---

## 1. グローバル起点チェーン（DAGルートノード群）

すべてのコンポーネントはこの起点群から派生する。

```
🟢 Cloudflare Account
  ├── 🟢 Cloudflare Access Application（Zero Trust ドメイン設定）
  ├── 🟢 D1 Database 作成
  ├── 🟢 R2 Bucket 作成
  ├── 🟢 Queue 作成（SNAPSHOT_QUEUE）
  ├── 🟢 Pages Project 作成
  └── 🟢 Secret 設定（OPENAI_API_KEY）

🟢 設計ドキュメント群（実装の知識起点）
  ├── 12_MIGRATION_SQL_FINAL.md → migrations/0001_initial_schema.sql
  ├── 11_ENUM_STATUS_SPEC.md → src/schemas/enums.ts (Zod)
  ├── 05_MASTER_DATA_PLAN_v3.md → seed JSON 4ファイル
  └── 02_COST_CALCULATION_DEFINITIONS_v2.md → 計算エンジンハンドラー仕様
```

### 1-1. 起動順序（厳密な実行依存チェーン）

```
Step 1:  Cloudflare Account 作成                  🟢 前提なし
Step 2:  Cloudflare Access Application 設定        → Step 1
Step 3:  D1 Database 作成 (wrangler d1 create)     → Step 1
Step 4:  R2 Bucket 作成                            → Step 1
Step 5:  Queue 作成 (SNAPSHOT_QUEUE)               → Step 1
Step 6:  Pages Project 作成                        → Step 1
Step 7:  Secret 設定 (OPENAI_API_KEY)              → Step 6
Step 8:  Hono プロジェクト初期化                    → Step 3, 4, 5, 6
Step 9:  wrangler.jsonc 設定（全 binding 記載）     → Step 3, 4, 5
Step 10: Migration 適用 (--local)                   → Step 9
Step 11: Seed JSON 修正 (B-01, B-02, B-03)         → 🟢 並行可
Step 12: import_seed_to_d1.ts 実行                 → Step 10, 11
Step 13: app_users 初期 admin 投入                  → Step 10, Step 2 (メール確定)
Step 14: Zod スキーマ実装                           → Step 8
Step 15: npm run build 成功                        → Step 14
Step 16: wrangler pages dev dist 起動              → Step 15, 12, 13
```

---

## 2. D1 テーブル依存関係（FK依存 DAG）

### 2-1. 作成レイヤー順序

```
Layer 0（🟢 依存なし — 先に作成必須）:
  ┌─────────────────┐  ┌─────────────┐  ┌─────────────────┐  ┌────────────┐
  │ cost_categories  │  │ app_users   │  │ system_settings │  │ area_rules │
  └────────┬────────┘  └──────┬──────┘  └─────────────────┘  └────────────┘
           │                  │
Layer 1（→ Layer 0 に依存）:
  ┌────────┴───────────┐     │
  │ cost_master_items  │     │
  │ (→category_code)   │     │
  └──┬──────┬──────┬──┘     │
     │      │      │        │
Layer 2（→ Layer 1 に依存）:
  ┌──┴──┐┌──┴──┐┌──┴────────┐  ┌──────────────────┐  ┌───────────────────┐
  │vers.││rules││qty_rules  │  │ projects         │  │ lineup_packages   │
  │     ││     ││           │  │ (→app_users ref)  │  │ (→category_code)  │
  └─────┘└─────┘└───────────┘  └────────┬─────────┘  └───────────────────┘
                                        │              ┌───────────────────┐
                                        │              │ product_catalog   │
                                        │              │ (→category_code)  │
                                        │              └───────────────────┘
Layer 3（→ Layer 2 に依存）:
  ┌─────────────────────┐  ┌──────────────────────┐  ┌───────────────────────┐
  │ cost_snapshot_jobs   │  │ project_phase_est.   │  │ project_sales_est.    │
  │ (→project_id)        │  │ (→project_id)        │  │ (→project_id)         │
  └──────────┬──────────┘  └──────────────────────┘  └───────────────────────┘
             │              ┌──────────────────────┐  ┌───────────────────────┐
             │              │ project_input_src.   │  │ external_references   │
             │              │ (→project_id)        │  │ (→project_id nullable)│
             │              └──────────────────────┘  └───────────────────────┘
             │              ┌──────────────────────┐  ┌───────────────────────┐
             │              │ project_audit_logs   │  │ master_change_logs    │
             │              │ (→project_id)        │  │ (独立)                │
             │              └──────────────────────┘  └───────────────────────┘
             │
Layer 4（→ Layer 3 に依存）:
  ┌──────────┴───────────┐
  │ project_cost_snapshots│
  │ (→project, →job)     │
  └──────────┬───────────┘
             │
Layer 5（→ Layer 4 に依存）:
  ┌──────────┴──────────────────┐  ┌──────────────────────────────┐
  │ project_cost_items          │  │ project_warnings             │
  │ (→project, →master_items,   │  │ (→project, →snapshot nullable)│
  │  →versions, →product_cat.)  │  └──────────────────────────────┘
  └──────────┬─────────────────┘
             │
Layer 6（→ Layer 5 に依存）:
  ┌──────────┴─────────────────┐  ┌─────────────────────────────────┐
  │ project_cost_summaries     │  │ project_cost_regeneration_diffs │
  │ (→project, category_code   │  │ (→job, →project, →snapshots)    │
  │  UNIQUE)                   │  └─────────────────────────────────┘
  └────────────────────────────┘
```

### 2-2. ⚠️ 循環参照（アプリ層で解決）

```
projects.current_snapshot_id ──→ project_cost_snapshots.id
project_cost_snapshots       ──→ projects.id

解決策:
  1. DB上のFK制約は張らない
  2. projects を先に CREATE（current_snapshot_id = NULL）
  3. snapshot生成完了後: UPDATE projects SET current_snapshot_id = ? [アプリ層TX]
```

### 2-3. テーブル間データフロー（DAG）

```
[Seed JSON] ──import──> cost_categories ──(category_code)──> cost_master_items
                                                              ├──> cost_master_item_versions
                                                              └──> cost_rule_conditions

[ユーザー操作] ──> projects ──(project_id)──┬──> cost_snapshot_jobs
                                            │       ↓ [ASYNC Queue]
                                            │   project_cost_snapshots
                                            │       ↓
                                            ├──> project_cost_items ──> project_cost_summaries
                                            │       ↓
                                            ├──> project_warnings
                                            ├──> project_audit_logs
                                            ├──> project_sales_estimates
                                            └──> project_input_sources

[再生成時のみ]
cost_snapshot_jobs ──> project_cost_regeneration_diffs
                       (旧snapshot vs 新snapshot の差分)

[projects.current_snapshot_id] ←⚠️── project_cost_snapshots.id
```

---

## 3. コンポーネント別 依存詳細表

### 3-1. 認証・認可レイヤー

| コンポーネント | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|---------------|------|------|------|---------|-----|-----------|------|
| Cloudflare Access | CF Account, ドメイン設定 | ユーザーメール | JWT (CF-Access-JWT-Assertion) | なし | - | SYNC | public |
| auth.ts middleware | Access設定済, app_users投入済 | CF-Access-* ヘッダー | `c.set('user',{id,email,role})` | app_users.last_login_at | - | SYNC | 全ロール |
| rbac.ts middleware | auth.ts通過済 | `c.get('user').role` + ルート定義 | 許可/403拒否 | なし | - | SYNC | ルートごと |
| 開発環境バイパス | .dev.vars DEV_USER_EMAIL | DEV_USER_EMAIL | 擬似認証コンテキスト | なし | - | SYNC | 開発のみ |

### 3-2. Seed / Migration / Import レイヤー

| コンポーネント | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|---------------|------|------|------|---------|-----|-----------|------|
| migrations/0001_initial_schema.sql | D1 DB作成済 | SQL DDL (12_MIGRATION_SQL_FINAL.md) | 25テーブル + 47idx + system_settings 9件 | 全テーブル構造 | 1TX | SYNC | CLI |
| import_seed_to_d1.ts | migration適用済, B-01/02/03修正済 | 4 seed JSON | D1にマスタデータ投入 | cost_categories(10), items(49), versions(49), rules(54) | 4TX(テーブル別) | SYNC | CLI |
| app_users admin INSERT | migration適用済, CFメール確定 | admin email/name | app_users 1レコード | app_users | 1TX | SYNC | CLI |
| seed JSON 修正 (B-01) | なし | seed_rules_priority_a.json | lineup値アンダースコア統一 | JSONファイル | - | - | 開発者 |
| seed JSON 修正 (B-02) | なし | seed_items/rules_priority_a.json | item_panel_shipping金額修正 | JSONファイル | - | - | 開発者 |
| seed JSON 修正 (B-03) | なし | seed_items_priority_a.json | calculation_type→per_piece | JSONファイル | - | - | 開発者 |

### 3-3. 画面レイヤー

| 画面 | URL | 前提 | 入力 | 出力(表示) | 使用API | 読取テーブル | 更新テーブル | 権限 |
|------|-----|------|------|-----------|---------|-------------|-------------|------|
| LOGIN | `/login` | CF Access設定済 | メール/IdP認証 | JWT+リダイレクト | (CF Access) | - | - | public |
| ACCESS_CALLBACK | (redirect) | JWT有効 | JWT | ダッシュボード遷移 | GET /api/users/me | app_users | app_users.last_login_at | 全ロール |
| DASHBOARD | `/` | auth | - | 案件一覧+サマリー+通知 | GET /projects, GET /master/changes/recent | projects, master_change_logs | - | 全ロール |
| PROJECT_NEW | `/projects/new` | auth | 案件基本情報+条件 | 新案件(YYYY-NNN) | POST /projects | cost_categories | projects, project_audit_logs | admin,mgr,est |
| PROJECT_DETAIL | `/projects/:id` | auth, 案件存在 | 更新データ+version | 案件詳細表示 | GET/PUT /projects/:id | projects | projects, project_audit_logs | 全(閲覧),admin/mgr/est(編集) |
| COST_OVERVIEW | `/projects/:id/costs` | auth, 案件存在 | 計算実行指示 | 37工種サマリー+ジョブ状態 | GET /costs, POST /calculate, GET /calculate/status | summaries, warnings, jobs | cost_snapshot_jobs | 全(閲覧),admin/mgr/est(計算) |
| COST_CATEGORY | `/projects/:id/costs/:categoryCode` | auth, snapshot存在 | 手修正値+override_reason | 明細一覧+インライン編集 | GET /costs/:cc, PUT /costs/:itemId | items, master_items | items, summaries, audit_logs | 全(閲覧),admin/mgr/est(編集) |
| COST_SUMMARY | `/projects/:id/summary` | auth, snapshot存在 | 売価見積データ | 3グループ原価集計+粗利 | GET /summary, POST /sales-estimates | summaries, sales_est | sales_estimates | 全(閲覧),admin/mgr/est(見積) |
| DIFF_REVIEW | `/projects/:id/diffs` | auth, regenerate済 | 承認/却下指示 | 差分一覧+承認UI | GET /diffs, PUT /diffs/:id/accept | regen_diffs | items, audit_logs | admin, manager |
| WARNINGS | `/projects/:id/warnings` | auth | 解決note | 警告一覧+解決UI | GET /warnings, PUT /warnings/:id/resolve | warnings | warnings | 全(閲覧),admin/mgr/est(解決) |
| MASTER_CATEGORIES | `/master/categories` | auth, seed投入済 | 工種データ | 工種一覧+編集フォーム | GET/POST/PUT /master/categories | cost_categories | categories, change_logs | admin(編集),全(閲覧) |
| MASTER_ITEMS | `/master/items` | auth, seed投入済 | 明細+バージョン | 明細一覧+バージョン管理 | GET/POST/PUT /master/items, /versions | items, versions | items, versions, change_logs | admin(編集),全(閲覧) |
| MASTER_RULES | `/master/rules` | auth, seed投入済 | - | ルール一覧(閲覧のみ Phase1) | GET /master/rules | rules | - | 全ロール |
| MASTER_PRODUCTS | `/master/products` | auth | 商品データ | 商品一覧+編集 | GET/POST/PUT /master/products | product_catalog | catalog, change_logs | admin(編集),全(閲覧) |
| USER_MGMT | `/admin/users` | auth(admin) | ユーザーデータ | ユーザー一覧+管理 | GET/POST/PUT /users, /deactivate | app_users | app_users | admin |
| CHANGE_LOG | `/logs` | auth | フィルタ条件 | 変更履歴一覧 | GET /projects/:id/logs, GET /master/logs | audit_logs, change_logs | - | 全ロール |
| SETTINGS | `/admin/settings` | auth(admin) | 設定値 | 設定一覧+編集 | GET/PUT /settings | system_settings | system_settings | admin |

### 3-4. API エンドポイント レイヤー

#### 3-4-1. ヘルスチェック・管理

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/health` | GET | DB接続 | なし | `{status,db,timestamp}` | なし | - | SYNC | public |
| `/api/admin/seed/validate` | POST | migration適用済 | seed JSON | バリデーション結果 | なし | - | SYNC | admin |
| `/api/admin/seed/import` | POST | validate通過 | seed JSON | import結果 | categories, items, versions, rules | TX×4 | SYNC | admin |

#### 3-4-2. ユーザー管理

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/users` | GET | auth | page,per_page,role?,status? | ユーザー一覧 | なし | - | SYNC | admin |
| `/api/users` | POST | auth | email,name,role,dept? | 新ユーザー | app_users | - | SYNC | admin |
| `/api/users/:id` | GET | auth | - | ユーザー詳細 | なし | - | SYNC | admin,mgr |
| `/api/users/:id` | PUT | auth | role?,status?,name? | 更新結果 | app_users | - | SYNC | admin |
| `/api/users/:id/deactivate` | POST | auth | - | 無効化結果 | app_users(status→inactive) | - | SYNC | admin |
| `/api/users/me` | GET | auth | - | 自分の情報 | なし | - | SYNC | 全ロール |

#### 3-4-3. マスタ管理

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/master/categories` | GET | seed投入済 | sort?,filter? | 工種一覧(37件) | なし | - | SYNC | 全ロール |
| `/api/master/categories` | POST | auth | category定義 | 新工種 | cost_categories, master_change_logs | TX | SYNC | admin |
| `/api/master/categories/:code` | PUT | auth | 更新データ | 更新結果 | cost_categories, master_change_logs | TX | SYNC | admin |
| `/api/master/items` | GET | seed投入済 | category_code?,calc_type? | 明細一覧 | なし | - | SYNC | 全ロール |
| `/api/master/items` | POST | auth | item定義 | 新明細 | items, versions, master_change_logs | TX | SYNC | admin |
| `/api/master/items/:id` | PUT | auth | 更新データ | 更新結果 | items, master_change_logs | TX | SYNC | admin |
| `/api/master/items/:id/versions` | GET | - | - | バージョン一覧 | なし | - | SYNC | 全ロール |
| `/api/master/items/:id/versions` | POST | auth | 新バージョン | バージョン追加 | versions, master_change_logs | TX | SYNC | admin |
| `/api/master/items/:id/versions/current` | GET | - | - | 現在有効バージョン | なし | - | SYNC | 全ロール |
| `/api/master/rules` | GET | seed投入済 | master_item_id?,rule_group? | ルール一覧 | なし | - | SYNC | 全ロール |
| `/api/master/products` | GET | - | category_code? | 商品一覧 | なし | - | SYNC | 全ロール |
| `/api/master/products` | POST | auth | 商品データ | 新商品 | product_catalog, master_change_logs | TX | SYNC | admin |
| `/api/master/products/:id` | PUT | auth | 更新データ | 更新結果 | product_catalog, master_change_logs | TX | SYNC | admin |
| `/api/master/logs` | GET | - | target_table?,date_range? | 変更履歴 | なし | - | SYNC | 全ロール |
| `/api/master/changes/recent` | GET | - | limit? | 直近変更 | なし | - | SYNC | 全ロール |
| `/api/master/changes/:id/affected-projects` | GET | - | - | 影響案件一覧 | なし | - | SYNC | admin,mgr |

#### 3-4-4. 案件管理

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/projects` | GET | - | page,status?,lineup?,search?,assigned_to? | 案件一覧 | なし | - | SYNC | 全ロール |
| `/api/projects` | POST | auth | 案件データ | 新案件(YYYY-NNN自動採番) | projects, project_audit_logs | TX | SYNC | admin,mgr,est |
| `/api/projects/:id` | GET | - | - | 案件詳細 | なし | - | SYNC | 全ロール |
| `/api/projects/:id` | PUT | auth,version | 更新データ+version | 更新結果(楽観ロック) | projects, project_audit_logs | TX | SYNC | admin,mgr,est(自分の) |
| `/api/projects/:id/archive` | POST | auth | - | アーカイブ結果 | projects(status→archived) | TX | SYNC | admin,mgr |

#### 3-4-5. 原価計算・スナップショット（★最重要）

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/projects/:id/calculate` | POST | 案件存在, アクティブジョブなし | job_type, target_categories?, preserve_manual_edits? | 202 Accepted {job_id} | cost_snapshot_jobs(queued) | TX(INSERT) | **ASYNC** | admin,mgr,est |
| `/api/projects/:id/calculate/status` | GET | job存在 | job_id? | ジョブ状態 | なし | - | SYNC | 全ロール |
| `/api/projects/:id/recalculate` | POST | 既存snapshot, アクティブジョブなし | job_type(regenerate系) | 202 Accepted {job_id} | cost_snapshot_jobs(queued) | TX(INSERT) | **ASYNC** | admin,mgr,est |
| `/api/projects/:id/recalculate/:categoryCode` | POST | 既存snapshot | target_categories=[cc] | 202 Accepted {job_id} | cost_snapshot_jobs(queued) | TX(INSERT) | **ASYNC** | admin,mgr,est |

**Queue Consumer (snapshotJobProcessor)**:

```
入口:   [SNAPSHOT_QUEUE] consume → job_id
前提:   cost_snapshot_jobs.status = 'queued'
入力:   job_id, project_id, job_type, target_categories_json, preserve_manual_edits
権限:   システム内部処理

処理シーケンス:
  TX-1: job.status → 'running', started_at 記録
  
  READ: projects 条件読み込み
  READ: cost_master_items + versions (有効バージョン) + rules
  READ: (regenerate時) 旧snapshot の project_cost_items
  
  COMPUTE: 計算エンジン実行
    ├── 第1パス: 全工種独立計算（12種ハンドラー）
    ├── 第2パス: cross_category ルール評価
    ├── final_* 算出（T-01 仕様）
    └── (regenerate時) diff計算（7種diff_type）
  
  TX-2: shadow snapshot 生成（最重要TX）
    a. project_cost_snapshots INSERT (status='active')
    b. project_cost_items INSERT × N（100件バッチ分割）
    c. project_cost_summaries UPSERT × 37
    d. project_warnings INSERT × M
    e. (regenerate時) project_cost_regeneration_diffs INSERT
    f. 旧 snapshot.status → 'superseded'
    g. projects.current_snapshot_id = 新snapshot.id
    h. projects.revision_no += 1
  
  POST: 売価乖離チェック
    ├── system_settings から閾値取得
    ├── 乖離率計算
    └── (超過時) project_warnings INSERT (type='sales_estimate_gap')
  
  TX-3: job.status → 'completed', result_snapshot_id, duration_ms 記録

失敗時:
  TX-F: job.status → 'failed', error_message, error_detail_json 記録
  (旧snapshot は一切変更されない → 安全)

更新対象:
  cost_snapshot_jobs, project_cost_snapshots, project_cost_items,
  project_cost_summaries, project_warnings, project_cost_regeneration_diffs,
  projects (current_snapshot_id, revision_no)
```

#### 3-4-6. 原価データ参照・編集

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/projects/:id/costs` | GET | snapshot存在 | - | 工種別原価一覧 | なし | - | SYNC | 全ロール |
| `/api/projects/:id/costs/:categoryCode` | GET | - | - | 工種内明細一覧 | なし | - | SYNC | 全ロール |
| `/api/projects/:id/costs/:itemId` | PUT | auth,version | manual_*,override_reason | 手修正結果(楽観ロック) | items, summaries, audit_logs | TX | SYNC | admin,mgr,est |
| `/api/projects/:id/costs/:categoryCode/items` | POST | auth | 新明細 | 追加結果 | items, summaries, audit_logs | TX | SYNC | admin,mgr,est |
| `/api/projects/:id/costs/:categoryCode/review` | PUT | auth | review_status,comment? | レビュー結果 | summaries, audit_logs | TX | SYNC | admin,mgr |
| `/api/projects/:id/summary` | GET | snapshot存在 | - | 原価サマリー(3グループ) | なし | - | SYNC | 全ロール |

#### 3-4-7. 警告・差分・売価見積

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/projects/:id/warnings` | GET | - | is_resolved?,severity? | 警告一覧 | なし | - | SYNC | 全ロール |
| `/api/projects/:id/warnings/:wid/resolve` | PUT | auth | resolved_note | 解決結果 | warnings(is_resolved,resolved_by,resolved_at) | - | SYNC | admin,mgr,est |
| `/api/projects/:id/diffs` | GET | regenerate済 | job_id?,is_significant? | 差分一覧 | なし | - | SYNC | 全ロール |
| `/api/projects/:id/diffs/:diffId/accept` | PUT | auth | - | 差分承認 | items, audit_logs | TX | SYNC | admin,mgr |
| `/api/projects/:id/sales-estimates` | GET | - | - | 売価見積一覧 | なし | - | SYNC | 全ロール |
| `/api/projects/:id/sales-estimates` | POST | snapshot存在 | estimate_type,粗利率等 | 新見積 | sales_estimates, audit_logs | TX | SYNC | admin,mgr,est |

#### 3-4-8. 変更履歴・AI連携・設定

| API | Method | 前提 | 入力 | 出力 | 更新対象 | TX | Sync/Async | 権限 |
|-----|--------|------|------|------|---------|-----|-----------|------|
| `/api/projects/:id/logs` | GET | - | target_type?,action? | 案件変更履歴 | なし | - | SYNC | 全ロール |
| `/api/logs` | GET | - | project_id?,date_range? | 全変更履歴 | なし | - | SYNC | admin,mgr |
| `/api/ai/check-conditions` | POST | OPENAI_API_KEY, 案件+明細 | project_id | チェック結果 | project_warnings | TX | SYNC | admin,mgr,est |
| `/api/ai/extract-from-pdf` | POST | OPENAI_API_KEY, R2 | PDF file | 構造化抽出結果 | project_input_sources | TX | SYNC(Phase 2) | admin,mgr |
| `/api/settings` | GET | - | setting_type? | 設定一覧 | なし | - | SYNC | admin |
| `/api/settings/:key` | PUT | auth | setting_value | 更新結果 | system_settings | - | SYNC | admin |

---

## 4. ★ 計算フロー DAG（最重要依存チェーン）

### 4-1. 初回計算フロー

```
ユーザー操作                      API / Queue                       DB 更新
──────────────                    ──────────                       ────────
[COST_OVERVIEW]
 │「原価計算実行」ボタン
 ↓
[POST /calculate]────────→ [SYNC] 排他チェック
                            │ SELECT COUNT(*) FROM cost_snapshot_jobs
                            │ WHERE project_id=? AND status IN ('queued','running')
                            │ → 0件なら続行、1件以上→409
                            ↓
                           [TX] cost_snapshot_jobs INSERT (status='queued')
                            ↓
                           [SYNC] Queue.send({job_id, project_id, job_type:'initial'})
                            ↓
                           return 202 Accepted {job_id}
 ↓
[ポーリング開始]
[GET /calculate/status]───→ cost_snapshot_jobs.status 返却
 │ (2秒間隔)
 ↓
                      [SNAPSHOT_QUEUE Consumer]
                            ↓
                           [TX-1] job.status → 'running'
                            ↓
                           [READ] projects 条件
                           [READ] master_items + versions + rules
                            ↓
                           [COMPUTE] 計算エンジン
                            │ 第1パス: 独立12ハンドラー
                            │ 第2パス: cross_category
                            │ final_* 算出
                            ↓
                           [TX-2] shadow snapshot書込
                            │ snapshots INSERT
                            │ cost_items INSERT (バッチ100件)
                            │ summaries UPSERT
                            │ warnings INSERT
                            │ 旧snapshot→superseded
                            │ projects.current_snapshot_id UPDATE
                            │ projects.revision_no++
                            ↓
                           [POST] 売価乖離チェック
                            ↓
                           [TX-3] job.status → 'completed'
 ↓
[ポーリングで completed 検知]
[GET /costs] ────────────→ 最新snapshot表示
```

### 4-2. 再生成フロー（diff生成込み）

```
[POST /recalculate]
  job_type = preserve_reviewed | auto_only | replace_all
  ↓
[Queue Consumer]
  ↓ READ: 旧snapshot items (current_snapshot_id参照)
  ↓ COMPUTE: 新計算実行
  ↓ COMPARE: 旧items vs 新items
  │   ├── item_name/master_item_id で照合
  │   ├── diff_type 判定（7種）
  │   ├── change_amount, change_percent 計算
  │   └── is_significant 判定（system_settings 閾値参照）
  ↓ MERGE: job_type に応じた保持ルール
  │   ├── preserve_reviewed: confirmed items → 旧値維持
  │   ├── auto_only: manual_* 設定済み → 旧値維持
  │   └── replace_all: 全items白紙再計算
  ↓ [TX-2] snapshot + items + summaries + warnings + diffs 一括書込
  ↓
[DIFF_REVIEW画面] → 差分一覧 → 承認/却下
```

---

## 5. トランザクション境界 完全一覧

| # | 操作 | TX範囲 | 更新テーブル数 | 最大行数 | 失敗時の影響 | D1制限考慮 |
|---|------|--------|-------------|---------|------------|-----------|
| T-1 | 案件作成 | 1TX | 2 | 2行 | 案件未作成（安全） | - |
| T-2 | 案件更新（楽観ロック） | 1TX | 2 | 2行 | 409返却（安全） | - |
| T-3 | マスタ更新 | 1TX | 2 | 2行 | マスタ未更新（安全） | - |
| T-4 | マスタバージョン追加 | 1TX | 2 | 2行 | バージョン未追加（安全） | - |
| T-5 | ジョブ投入 | 1TX | 1 | 1行 | ジョブ未登録（安全） | - |
| **T-6** | **★ snapshot生成** | **3TX** | **7** | **~500行** | TX-2失敗→job=failed, 旧snapshot維持 | **100件バッチ必須** |
| T-7 | 手修正 | 1TX | 3 | 3行 | 手修正未反映（安全） | - |
| T-8 | 差分承認 | 1TX | 2 | 2行 | 差分未承認（安全） | - |
| T-9 | シードインポート | 4TX | 4 | ~162行 | 途中失敗→要ロールバック | - |
| T-10 | AI条件チェック | 1TX | 1 | ~10行 | warnings未保存（安全） | - |
| T-11 | 売価見積保存 | 1TX | 2 | 2行 | 見積未保存（安全） | - |

---

## 6. 権限マトリクス（完全版 Phase 1）

| 操作 | admin | manager | estimator | viewer |
|------|-------|---------|-----------|--------|
| **ユーザー管理** CRUD | ✅ | ❌ | ❌ | ❌ |
| **system_settings 変更** | ✅ | ❌ | ❌ | ❌ |
| **マスタ管理** CRUD | ✅ | ❌ | ❌ | ❌ |
| **マスタ閲覧** | ✅ | ✅ | ✅ | ✅ |
| **シードインポート** | ✅ | ❌ | ❌ | ❌ |
| **案件作成** | ✅ | ✅ | ✅ | ❌ |
| **案件編集** | ✅ 全件 | ✅ 全件 | ✅ 自分の | ❌ |
| **案件アーカイブ** | ✅ | ✅ | ❌ | ❌ |
| **原価計算実行** | ✅ | ✅ | ✅ | ❌ |
| **手修正** | ✅ | ✅ | ✅ | ❌ |
| **工種レビュー** | ✅ | ✅ | ❌ | ❌ |
| **差分承認** | ✅ | ✅ | ❌ | ❌ |
| **警告解決** | ✅ | ✅ | ✅ | ❌ |
| **AI条件チェック** | ✅ | ✅ | ✅ | ❌ |
| **売価見積作成** | ✅ | ✅ | ✅ | ❌ |
| **変更履歴閲覧** | ✅ | ✅ | ✅ | ✅ |
| **ダッシュボード閲覧** | ✅ | ✅ | ✅ | ✅ |
| **案件詳細閲覧** | ✅ | ✅ | ✅ | ✅ |

---

## 7. 将来連携ポイント（Phase 2〜4 拡張スコープ）

### 7-1. 実績原価CSV取込（Phase 3）

```
[CSV / スプレッドシート]
  ├── 起点: ユーザーアップロード
  ├── 前提: project_actual_costs テーブル（Phase 3 migration）
  ├── 処理: R2保存 → CSV解析 → 工種マッピング → 差異分析
  ├── 入力: CSVファイル
  ├── 出力: 実績原価レコード + 差異分析
  ├── 更新: project_actual_costs(新規), project_input_sources
  ├── TX: 1TX (INSERT)
  ├── Sync/Async: SYNC (ファイルサイズ小) or ASYNC (大量データ)
  └── 権限: admin, manager
```

### 7-2. ANDPAD 連携（Phase 4）

```
前提: ANDPAD APIキー(Secret), 案件マッピングテーブル(新規)
起点: status='reviewed' の案件確定
入力: project_cost_items の final_* 値
出力: ANDPAD側への原価データ送信
更新: external_references (連携記録)
```

### 7-3. 材料発注書 PDF 生成（Phase 4）

```
前提: PDF生成ライブラリ(Workers対応), 発注書テンプレート
起点: 特定工種 confirmed
入力: items(is_selected=1, confirmed), master_items, product_catalog
出力: PDF → R2保存 → ダウンロードURL
更新: project_input_sources (source_type='api_import')
```

---

## 8. 段階的デプロイ除外順序（スパイクテスト失敗時）

```
除外優先度（先に除外 = 影響小）:
  1. options          → 金額影響小、手入力可
  2. furniture        → 都度見積前提
  3. tile_stone       → 図面依存
  4. tatami           → 商品選択型
  5. interior_doors   → 商品選択型
  6. sash             → 商品選択型
  7. earthwork        → 都度見積
  8. scaffolding      → シート未提出
  9. building_materials → シート未提出

最後まで維持（Priority A コア）:
  foundation, woodwork, insulation, shinkabe_panel, electrical_facility,
  roof, site_management, defect_insurance, cleaning, waste_box,
  hardware, crane, termite, external_audit, septic_tank, design, ground_survey
```

制御方法: `cost_snapshot_jobs.target_categories_json`
- NULL → 全工種計算
- `["foundation","woodwork",...]` → 指定工種のみ

---

*最終更新: 2026-03-07*
*改訂番号: v2（DAG構造全面改訂、起点/終端明示、コンポーネント別詳細表追加）*
*AI品質チェックガイドライン: 未入手・後追い反映*
