# 平松建築 概算原価管理システム (hiramatsu-cost)

## Project Overview
- **Name**: hiramatsu-cost
- **Version**: 0.10.0
- **Goal**: 平松建築の注文住宅 概算原価を自動算出し、売価ギャップ分析・リスク可視化を行う原価管理システム
- **Phase**: Step 10 完了 (ラインナップマスタ管理・単価マスタ入力改善)
- **Stack**: Hono + TypeScript + Cloudflare D1 + TailwindCSS + Alpine.js

## URLs
- **Sandbox**: https://3000-ir9zs5r25rb1al74y1qzm-3844e1b6.sandbox.novita.ai
- **UI Pages**:
  - `/ui/login` — ログイン画面
  - `/ui/projects` — 案件一覧
  - `/ui/projects/:id` — 案件詳細 (8タブ)
  - `/ui/admin` — 管理画面 (admin/managerのみ, 4タブ: ユーザー・単価マスタ・ラインナップ・システム設定)
  - `/ui/manual` — 使い方ガイド (13セクション)
- **API Health**: `/api/health`

## 完了済みステップ

| Step | 内容 | Status |
|------|-------|--------|
| Step 0 | Spike検証 (D1, Queue, Batch, Index, TX) | ✅ |
| Step 1 | DBスキーマ23テーブル + Seed (58 items, 47 rules, 10 categories, 9 settings) | ✅ |
| Step 2 | マスタ参照API + Project API + Snapshot Engine | ✅ |
| Step 2.5 | status遷移修正 + warnings shape + error code policy + sync_fallback | ✅ |
| Step 3 | Regenerate 3モード + Diff Resolution + 工種詳細Update + M3 milestone | ✅ |
| Step 4 | Sales Estimate + Risk Centre + AI Phase 1 + Frontend UI + M4 milestone | ✅ |
| Step 5 | Frontend Enhancement: Full 6-tab UI (Risk, Cost Items, Diff, Summary, Sales, AI) | ✅ |
| Step 6 | AI Production Hardening: graceful degradation, confidence/severity rules, warning CRUD, PDF UI | ✅ |
| Step 7 | OpenAI API Key Integration + M7 統合テスト (AI ai_enhanced モード確認) | ✅ |
| Step 8 | CR-03修正 (settings PATCH) + CR-05実装 (project edit tab) + デプロイ準備文書 + M8 E2E | ✅ |
| **Step 9** | **管理画面・認証・使い方ガイド・権限制御** | ✅ |
| **Step 10** | **ラインナップマスタ管理・単価マスタ入力改善** | ✅ **NEW** |

## Step 9 で実装した内容

### 1. 認証・ログイン機能
- Cookie ベースのセッション管理 (`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`)
- SHA-256 パスワードハッシュ (Cloudflare Workers 対応)
- 初回ログイン時にパスワード自動設定
- パスワード変更 (`/api/auth/change-password`)
- ログイン画面 (`/ui/login`)

### 2. 管理画面 (`/ui/admin`)
- **ユーザー管理タブ**: ユーザー追加・編集・無効化 (admin 権限のみ)
- **単価マスタタブ**: デフォルト単価の確認・変更 (admin 権限のみ)
  - カテゴリフィルタ・検索・鉛筆アイコンで個別編集
- **システム設定タブ**: 粗利率閾値・デフォルト値の変更

### 3. 権限制御 (4ロール)
| 権限 | 案件閲覧 | 案件作成・編集 | レビュー | ユーザー管理 | マスタ変更 |
|------|---------|-------------|---------|------------|---------|
| admin | 全案件 | ✅ | ✅ | ✅ | ✅ |
| manager | 全案件 | ✅ | ✅ | 一覧のみ | ❌ |
| estimator | 自分のみ | ✅ | ❌ | ❌ | ❌ |
| viewer | 自分のみ | ❌ | ❌ | ❌ | ❌ |

### 4. 案件情報タブ (入力フォーム)
6つのセクションで建物情報をフル編集可能:
- **基本情報**: 案件名, 顧客名, ラインナップ, ステータス, 断熱等級, 防火区分, 屋根形状, WB工法, 平屋, 二世帯
- **面積・寸法**: 坪数, 建築面積, 延床面積, 1F/2F面積, 屋根/外壁/内壁/天井面積, 基礎周長, 屋根周長, ポーチ面積
- **所在地**: 都道府県, 市区町村, 自治体コード, 住所テキスト
- **太陽光・オプション**: PV有無/容量/パネル数, 蓄電池有無/容量, ドーマー, ロフト, 焼杉
- **設備・インフラ**: 上水道引込, 下水道引込, メーター, 配管距離, 雨樋/竪樋延長
- **粗利率設定**: 標準/太陽光/オプション粗利率

### 5. 使い方ガイド (`/ui/manual`)
13セクション構成の完全マニュアル:
0. ログインとユーザー管理
1. 案件を作成する
2. 建物情報を入力する（案件情報タブ）
3. 初期計算を実行する
4. 個別の工種見積を修正する（工種明細タブ）
5. 原価サマリを確認する
6. 売価見積もりとは（売価の意味と使い方）
7. リスクセンターで全体確認
8. 仕様変更時の再計算と差分解決
9. ステータスの意味と遷移
10. 各タブの詳細ガイド
11. 単価マスタの変更方法
12. よくある質問（FAQ）— 11問
13. 用語集

### 6. ナビバー改善
- 「管理」リンクは admin/manager のみ表示
- 案件一覧に担当者名を表示

## Step 10 で実装した内容

### 1. ラインナップマスタ管理
- **lineups マスタテーブル**: code, name, short_name, description, is_custom, sort_order, is_active
- **初期データ**: SHIN, RIN, MOKU_OOYANE, MOKU_HIRAYA, MOKU_ROKU, CUSTOM（オーダーメイド）
- **管理画面**: ラインナップ管理タブ追加（一覧・追加・編集・有効化/無効化）
- **API**: GET /api/master/lineups, POST/PATCH /api/master/lineups/:code

### 2. 未定（null）とオーダーメイド（CUSTOM）の導入
- **未定 (null)**: 案件作成時のデフォルト。ラインナップ依存の工種は自動計算されず、手動入力にフォールバック
- **オーダーメイド (CUSTOM)**: 既製シリーズに当てはまらない自由設計案件。全ラインナップ依存工種が手動確認必要
- **projects.lineup**: NOT NULL → nullable に変更

### 3. リスクセンター警告の強化
- `lineup_undecided`: ラインナップ未定時の警告（severity: warning）
- `lineup_custom`: オーダーメイド案件のインフォメーション（severity: info）
- `lineup_dependent_manual_items`: ラインナップ依存工種の手動入力待ち件数

### 4. 原価計算エンジンの改善
- lineup=null/CUSTOM時、ラインナップ固定（lineup_fixed）やルール参照（rule_lookup）の工種に手動入力警告を自動付与
- 既存5ラインナップの計算ロジックに影響なし

### 5. UI改善
- **案件作成モーダル**: 動的ラインナップドロップダウン（APIから取得）、未定/CUSTOM選択時の注意メッセージ
- **案件情報タブ**: 動的ドロップダウン + 未定/CUSTOM時の視覚的警告
- **案件一覧**: ラインナップ名を日本語で表示、未定案件にバッジ表示
- **使い方ガイド**: ラインナップの説明を更新（未定・オーダーメイドの説明追加）

### 6. 単価マスタの入力改善（Step 9補完）
- 新規工種追加機能の実装（POST /api/master/items）
- 編集モーダルのフォーム修正（null値処理改善）
- カテゴリ名の日本語表示

## API一覧

### 認証 (NEW)
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/auth/login` | ログイン (email + password) |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在ユーザー情報 |
| POST | `/api/auth/change-password` | パスワード変更 |

### 管理 (NEW)
| Method | Path | 説明 | 権限 |
|--------|------|------|------|
| GET | `/api/admin/users` | ユーザー一覧 | admin, manager |
| POST | `/api/admin/users` | ユーザー追加 | admin |
| PATCH | `/api/admin/users/:id` | ユーザー編集 | admin |
| DELETE | `/api/admin/users/:id` | ユーザー無効化 | admin |
| GET | `/api/admin/stats` | 管理ダッシュボード統計 | admin, manager |

### ヘルス・システム
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/health` | ヘルスチェック (version, phase) |

### マスタデータ
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/master/categories` | カテゴリ一覧 (10件) |
| GET | `/api/master/items` | 工種一覧 (58件, ?category, ?active_only) |
| POST | `/api/master/items` | 新規工種追加 (admin) |
| PATCH | `/api/master/items/:id` | 工種更新 (admin) |
| GET | `/api/master/lineups` | ラインナップ一覧 (?active_only) |
| POST | `/api/master/lineups` | ラインナップ追加 (admin) |
| PATCH | `/api/master/lineups/:code` | ラインナップ更新 (admin) |
| GET | `/api/master/system-settings` | システム設定一覧 |
| PATCH | `/api/master/system-settings/:key` | システム設定更新 |

### プロジェクト
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/projects` | 案件一覧 (権限ベース表示) |
| GET | `/api/projects/:id` | 案件詳細 |
| POST | `/api/projects` | 案件作成 (自動担当者設定) |
| PATCH | `/api/projects/:id` | 案件編集 (全フィールド対応) |

### スナップショット・差分・原価
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/projects/:id/snapshots/enqueue` | スナップショット生成/再計算 |
| GET | `/api/projects/:id/snapshots` | スナップショット一覧 |
| GET | `/api/projects/:id/diffs` | 差分一覧 |
| POST | `/api/projects/:id/diffs/:diffId/resolve` | 差分解決 |
| PATCH | `/api/projects/:id/cost-items/:itemId` | 原価明細更新 |

### 売価見積
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/projects/:id/sales-estimates` | 売価見積作成 |
| GET | `/api/projects/:id/gap-analysis` | ギャップ分析 |

### リスクセンター
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/projects/:id/risk-centre` | リスクサマリー |

### AI
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/ai/status` | AI稼働状態 |
| POST | `/api/ai/check-conditions` | 条件チェック |
| GET | `/api/ai/warnings/:projectId` | 警告一覧 |

## UI タブ構成 (案件詳細)
1. **リスクセンター** — 入力充足率・リスクスコア・アクション要否
2. **案件情報** — 建物情報の入力・編集 (6セクション, 自動保存)
3. **工種明細** — 58工種の自動算出結果と手動上書きモーダル
4. **差分解決** — 再計算時の変更点確認と承認 (4アクション)
5. **原価サマリ** — カテゴリ別集計・総額
6. **売価見積** — 売価入力 + ギャップ分析ビジュアライゼーション
7. **AI・警告** — AIステータス・条件チェック・警告CRUD・PDF読取

## Data Architecture
- **Database**: Cloudflare D1 (SQLite) — 24テーブル
- **Migrations**: 7ファイル (0001〜0007)
- **Seed**: 10カテゴリ / 58工種 / 47ルール / 9システム設定 / 6ラインナップ
- **Auth**: Cookie session + CF Access + dev email bypass
- **Enums**: 37 Zod enum definitions

## File Structure
```
src/
├── index.tsx                    # Main app, route mounting
├── types/bindings.ts           # Cloudflare bindings, AppEnv
├── schemas/enums.ts            # 37 Zod enum definitions
├── lib/errors.ts               # Error code policy (400-500)
├── middleware/auth.ts           # resolveUser + requireRole
├── engine/
│   ├── snapshotGenerator.ts    # Initial snapshot generation
│   └── regenerateEngine.ts     # Regeneration (3 modes) + diff
├── services/
│   └── queueService.ts         # Queue + sync fallback
└── routes/
    ├── admin.ts                # Auth + User CRUD API (NEW)
    ├── master.ts               # Master data API
    ├── projects.ts             # Project CRUD + access control
    ├── snapshots.ts            # Snapshot + Diffs API
    ├── costItems.ts            # Cost item update + review
    ├── salesEstimates.ts       # Sales estimate + gap
    ├── riskCentre.ts           # Risk centre aggregation
    ├── ai.ts                   # AI Phase 1
    └── ui.ts                   # Frontend UI (Alpine.js)
migrations/
├── 0001_initial_schema.sql
├── 0002_cr01_cr02_tables_and_columns.sql
├── 0003_warnings_source_status.sql
├── 0004_diff_resolution_columns.sql
├── 0005_ai_warnings_read_status.sql
└── 0006_auth_and_admin.sql
└── 0007_lineups_master_and_nullable_project_lineup.sql  # NEW
```

## Deployment
- **Platform**: Cloudflare Pages (local dev with wrangler)
- **Status**: ✅ Active (Sandbox)
- **Last Updated**: 2026-03-09
- **Version**: 0.10.0

## Next Steps
- [ ] Cloudflare Pages 本番デプロイ実行
- [ ] AI Phase 2: GPT-4o直接接続強化
- [ ] lineup_packages / lineup_option_groups テーブルの活用（Phase 2 予約）
- [ ] CR-06: バッチレビュー
- [ ] CR-07: CSVエクスポート
- [ ] Cloudflare Access 認証設定
