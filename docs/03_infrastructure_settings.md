# 平松建築 概算原価管理システム - 本番インフラ設定一覧

**バージョン**: 0.8.0-step8  
**更新日**: 2026-03-08  
**対象者**: インフラ担当者・デプロイ担当者

---

## 1. Cloudflare Pages プロジェクト

| 項目 | 値 |
|------|-----|
| プロジェクト名 | `hiramatsu-cost` |
| プロダクションブランチ | `main` |
| ビルド出力ディレクトリ | `./dist` |
| 互換性日付 | `2026-03-08` |
| 互換性フラグ | `nodejs_compat` |
| フレームワーク | Hono + Vite |
| バンドルサイズ | ~326 KB (gzip前) |

### 1.1 Pages プロジェクト作成コマンド

```bash
npx wrangler pages project create hiramatsu-cost \
  --production-branch main \
  --compatibility-date 2026-03-08
```

### 1.2 デプロイコマンド

```bash
npm run build
npx wrangler pages deploy dist --project-name hiramatsu-cost
```

---

## 2. D1 Database

| 項目 | 値 |
|------|-----|
| データベース名 | `hiramatsu-cost-production` |
| バインディング名 | `DB` |
| データベースID | *作成後に取得 (`wrangler d1 create` の出力)* |
| テーブル数 | 23 (+ system_settings) |
| マイグレーション数 | 5 |
| シードデータ | 10カテゴリ / 58工種 / 47ルール / 9システム設定 |

### 2.1 D1 作成コマンド

```bash
# 本番データベース作成
npx wrangler d1 create hiramatsu-cost-production

# 出力例:
# ✅ Successfully created DB 'hiramatsu-cost-production'
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
# → wrangler.jsonc の database_id に設定
```

### 2.2 マイグレーション適用

```bash
# 本番DBにマイグレーション適用
npx wrangler d1 migrations apply hiramatsu-cost-production

# シードデータ投入 (初回のみ)
npx wrangler d1 execute hiramatsu-cost-production --file=./seed/seed_import.sql
```

### 2.3 マイグレーションファイル一覧

| # | ファイル | 内容 | テーブル数 |
|---|---------|------|-----------|
| 0001 | `initial_schema.sql` | 全テーブル・インデックス・初期データ | 23 |
| 0002 | `cr01_cr02_tables_and_columns.sql` | CR-01/02 追加カラム・テーブル | +2 |
| 0003 | `warnings_source_status.sql` | 警告テーブル拡張 | 0 (カラム追加) |
| 0004 | `diff_resolution_columns.sql` | 差分解決カラム追加 | 0 (カラム追加) |
| 0005 | `ai_warnings_read_status.sql` | AI警告既読ステータス | 0 (カラム追加) |

### 2.4 テーブル一覧 (23テーブル)

| # | テーブル名 | 用途 |
|---|-----------|------|
| 1 | `projects` | 案件マスタ (50+フィールド) |
| 2 | `cost_categories` | 原価カテゴリ (10カテゴリ) |
| 3 | `cost_master_items` | 原価マスタ工種 (58工種) |
| 4 | `cost_master_item_versions` | 工種バージョン履歴 |
| 5 | `cost_rule_conditions` | 原価ルール条件 (47ルール) |
| 6 | `quantity_rule_tables` | 数量ルールテーブル |
| 7 | `lineup_packages` | ラインナップパッケージ |
| 8 | `product_catalog` | 商品カタログ |
| 9 | `area_rules` | 面積ルール |
| 10 | `project_cost_items` | 案件別原価明細 |
| 11 | `project_cost_summaries` | 案件別原価集計 |
| 12 | `project_warnings` | 案件警告 |
| 13 | `master_change_logs` | マスタ変更ログ |
| 14 | `project_audit_logs` | 案件監査ログ |
| 15 | `app_users` | アプリユーザー |
| 16 | `project_phase_estimates` | フェーズ別見積 |
| 17 | `cost_snapshot_jobs` | スナップショットジョブキュー |
| 18 | `project_cost_snapshots` | 原価スナップショット |
| 19 | `project_cost_regeneration_diffs` | 再計算差分 |
| 20 | `project_sales_estimates` | 売価見積 |
| 21 | `project_input_sources` | 入力ソース管理 |
| 22 | `external_references` | 外部参照 |
| 23 | `system_settings` | システム設定 (9項目) |

### 2.5 wrangler.jsonc 設定

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "hiramatsu-cost",
  "compatibility_date": "2026-03-08",
  "pages_build_output_dir": "./dist",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hiramatsu-cost-production",
      "database_id": "<wrangler d1 create で取得したID>"
    }
  ]
}
```

---

## 3. Secrets (環境変数)

| 変数名 | 用途 | 必須 | 設定方法 |
|--------|------|------|---------|
| `OPENAI_API_KEY` | OpenAI API接続キー | オプション (なければrule-basedフォールバック) | `wrangler pages secret put OPENAI_API_KEY` |
| `DEV_USER_EMAIL` | 開発用認証バイパス | 開発のみ | `.dev.vars` (本番では不要) |

### 3.1 Secret 設定コマンド

```bash
# OpenAI APIキー設定
npx wrangler pages secret put OPENAI_API_KEY --project-name hiramatsu-cost
# プロンプトで sk-xxxx... を入力

# 設定確認
npx wrangler pages secret list --project-name hiramatsu-cost
```

### 3.2 ローカル開発用 (.dev.vars)

```bash
# .dev.vars ファイル (gitignore済み)
DEV_USER_EMAIL=admin@hiramatsu.co.jp
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
```

---

## 4. Queue (将来対応)

| 項目 | 値 | ステータス |
|------|-----|-----------|
| キュー名 | `SNAPSHOT_QUEUE` | **未有効化** (sync fallbackで代替中) |
| バインディング名 | `SNAPSHOT_QUEUE` | wrangler.jsonc でコメントアウト中 |
| 最大バッチサイズ | 1 | - |
| 用途 | スナップショット生成の非同期処理 | sync fallback で 8/8 テスト PASS |

### 4.1 有効化手順 (将来)

```bash
# 1. Cloudflare Queue 作成
npx wrangler queues create SNAPSHOT_QUEUE

# 2. wrangler.jsonc の Queue セクションのコメントを解除

# 3. Consumer を実装 (workers queue consumer)

# 4. 再デプロイ
npm run build && npx wrangler pages deploy dist --project-name hiramatsu-cost
```

### 4.2 現行 sync fallback の動作

- Queue バインディング未設定時、自動で sync fallback モードに切替
- ジョブは同期的に実行 (enqueue → 即時running → completed)
- 全8テスト (T1-T8) PASS 確認済み
- 本番で Queue が必要になるのは**同時アクセス多数時**

---

## 5. Cloudflare Access (認証) — 将来対応

| 項目 | 値 | ステータス |
|------|-----|-----------|
| Access ポリシー | 未設定 | **将来対応** |
| 認証ヘッダー | `CF-Access-Authenticated-User-Email` | コード側は対応済み |
| フォールバック | `DEV_USER_EMAIL` 環境変数 | 開発時のみ |

### 5.1 Access 設定手順 (将来)

1. Cloudflare Zero Trust ダッシュボードで Application を作成
2. ポリシー設定: `@hiramatsu.co.jp` ドメインのメールアドレスのみ許可
3. `hiramatsu-cost.pages.dev` をアプリケーションドメインに設定
4. Workers 側で `CF-Access-Authenticated-User-Email` ヘッダーを読み取り

---

## 6. 本番デプロイ チェックリスト

### 6.1 初回デプロイ

- [ ] **Cloudflare アカウント** で API Token 取得済み
- [ ] `npx wrangler whoami` で認証確認
- [ ] **D1 データベース作成**: `npx wrangler d1 create hiramatsu-cost-production`
- [ ] **wrangler.jsonc** の `database_id` を更新
- [ ] **マイグレーション適用**: `npx wrangler d1 migrations apply hiramatsu-cost-production`
- [ ] **シードデータ投入**: `npx wrangler d1 execute hiramatsu-cost-production --file=./seed/seed_import.sql`
- [ ] **Pages プロジェクト作成**: `npx wrangler pages project create hiramatsu-cost --production-branch main`
- [ ] **ビルド**: `npm run build`
- [ ] **デプロイ**: `npx wrangler pages deploy dist --project-name hiramatsu-cost`
- [ ] **Secret 設定**: `npx wrangler pages secret put OPENAI_API_KEY`
- [ ] **ヘルスチェック**: `curl https://hiramatsu-cost.pages.dev/api/health`
- [ ] **UI確認**: ブラウザで `https://hiramatsu-cost.pages.dev/ui/projects`
- [ ] **API確認**: マスタデータ・AI状態・設定取得

### 6.2 更新デプロイ

- [ ] コード変更を `git commit`
- [ ] `npm run build` 成功
- [ ] M8テスト (E2Eフルフロー) PASS
- [ ] マイグレーション追加がある場合 → 本番DB適用
- [ ] `npx wrangler pages deploy dist --project-name hiramatsu-cost`
- [ ] ヘルスチェック・UI確認

---

## 7. APIエンドポイント一覧

### 7.1 ヘルス・システム

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/health` | ヘルスチェック |

### 7.2 マスタデータ (Read Only)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/master/categories` | カテゴリ一覧 |
| GET | `/api/master/categories/:code` | カテゴリ詳細 |
| GET | `/api/master/items` | 工種一覧 (?category, ?active_only) |
| GET | `/api/master/items/:id` | 工種詳細 |
| GET | `/api/master/items/:id/versions` | 工種バージョン履歴 |
| GET | `/api/master/rules` | ルール条件一覧 (?item_id, ?rule_group) |
| GET | `/api/master/system-settings` | システム設定一覧 |
| PATCH | `/api/master/system-settings/:key` | システム設定更新 (CR-03) |
| GET | `/api/master/users` | ユーザー一覧 |
| GET | `/api/master/users/me` | 現在のユーザー |

### 7.3 プロジェクト

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects` | 案件一覧 (?status, ?page, ?per_page) |
| GET | `/api/projects/:id` | 案件詳細 |
| POST | `/api/projects` | 案件作成 |
| PATCH | `/api/projects/:id` | 案件編集 (CR-05) |

### 7.4 スナップショット

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects/:id/snapshots` | スナップショット一覧 |
| POST | `/api/projects/:id/snapshots` | スナップショット生成 |
| POST | `/api/projects/:id/snapshots/regenerate` | 再計算 (3モード) |

### 7.5 原価明細

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects/:id/cost-items` | 原価明細一覧 |
| PATCH | `/api/projects/:id/cost-items/:itemId` | 原価明細更新 (手動上書き) |
| GET | `/api/projects/:id/cost-summaries` | 原価集計 |

### 7.6 差分解決

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects/:id/diffs` | 差分一覧 |
| PATCH | `/api/projects/:id/diffs/:diffId` | 差分解決 (accept/reject/manual) |

### 7.7 売価見積

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/projects/:id/sales-estimate` | 売価見積作成 |
| GET | `/api/projects/:id/gap-analysis` | ギャップ分析 |

### 7.8 リスクセンター

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects/:id/risk-centre` | リスクサマリー |

### 7.9 AI

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/ai/status` | AI稼働状態 |
| POST | `/api/ai/check-conditions` | 条件チェック (47ルール) |
| POST | `/api/ai/classify-override-reason` | 変更理由分類 |
| POST | `/api/ai/parse-document` | 書類解析 |
| GET | `/api/ai/warnings/:projectId` | 警告一覧 |
| PATCH | `/api/ai/warnings/:warningId` | 警告更新 (read/resolve/ignore/reopen) |

### 7.10 UI

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/ui/projects` | 案件一覧画面 |
| GET | `/ui/projects/:id` | 案件詳細画面 (7タブ) |

---

## 8. リソース制限 (Cloudflare Pages Free Plan)

| 項目 | 制限値 | 現在の使用量 |
|------|--------|-------------|
| Workers CPU時間 | 10ms/リクエスト | 正常範囲内 |
| Workers バンドルサイズ | 10MB | 326KB |
| D1 読み取り | 5M行/日 | 少量 |
| D1 書き込み | 100K行/日 | 少量 |
| D1 ストレージ | 5GB | 少量 |
| リクエスト数 | 100K/日 | 少量 |

---

## 9. 本番URL一覧

| 用途 | URL |
|------|-----|
| 本番サイト | `https://hiramatsu-cost.pages.dev` |
| UI入口 | `https://hiramatsu-cost.pages.dev/ui/projects` |
| ヘルスチェック | `https://hiramatsu-cost.pages.dev/api/health` |
| AI状態 | `https://hiramatsu-cost.pages.dev/api/ai/status` |
| Cloudflare Dashboard | `https://dash.cloudflare.com` → Workers & Pages → hiramatsu-cost |
