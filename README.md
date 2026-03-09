# 平松建築 概算原価管理システム (hiramatsu-cost)

## Project Overview
- **Name**: hiramatsu-cost
- **Version**: 0.12.0
- **Goal**: 平松建築の注文住宅 概算原価を自動算出し、売価ギャップ分析・リスク可視化を行う原価管理システム
- **Phase**: v0.12.0 — 認証強化 + レビューチェックシート + 計算根拠モーダル強化（本番デプロイ済み）
- **Stack**: Hono + TypeScript + Cloudflare D1 + TailwindCSS + Alpine.js

## URLs
- **Production**: https://hiramatsu-cost-8ly.pages.dev
- **UI Pages**:
  - `/ui/login` -- ログイン画面（パスワードリセット対応）
  - `/ui/projects` -- 案件一覧
  - `/ui/projects/:id` -- 案件詳細 (8タブ)
  - `/ui/admin` -- 管理画面 (admin/managerのみ, 4タブ: ユーザー・単価マスタ・ラインナップ・システム設定)
  - `/ui/manual` -- 使い方ガイド (13セクション)
- **API Health**: `/api/health`

## v0.12.0 で追加された機能

### 認証強化
- **パスワードリセット**: SendGrid連携で6桁リセットコードをメール送信
  - `/api/auth/reset-request` — リセットコード送信（30分有効）
  - `/api/auth/reset-confirm` — コード検証＋新パスワード設定
- **ログイン画面**: 「パスワードを忘れた方」リンク → リセットリクエスト → コード入力 → 新パスワード設定の3段階フロー
- **本番認証検証済**: admin初回ログイン → パスワード設定 → ログアウト → 再ログイン 全ステップ成功

### レビューチェックシートタブ（新規）
- カテゴリ別レビュー進捗表示（全工種/確認済/未確認/要修正/ルール追加要/金額0円）
- プログレスバー（レビュー完了率をリアルタイム表示）
- **一括ステータス変更**: カテゴリ内の全工種を「OK」「リセット」に一括変更
- **個別クイックレビュー**: 工種ごとにOK/要修正/ルール追加要ボタン
- カテゴリフィルタリング

### 計算根拠モーダル強化
- **計算式の明示表示**: 例「32坪 × ¥29,000/坪 = ¥928,000」
- **入力値マッピング**: 使用した入力値（坪数、面積、等級等）とその出典（建物条件 or 単価マスタ）を一覧表示
- **クイックレビューボタン**: モーダル内から直接OK/要修正/ルール追加要を設定可能
- 対応計算タイプ: per_tsubo, per_m2, per_meter, per_piece, fixed_amount, lineup_fixed, range_lookup, rule_lookup, threshold_surcharge, manual_quote

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
| Step 9 | 管理画面・認証・使い方ガイド・権限制御 | ✅ |
| Step 10 | ラインナップマスタ管理・単価マスタ入力改善 | ✅ |
| **P1** | **UI/UX改善: 画面の明確化・ガイド強化** | ✅ |
| **P2** | **UI/UX改善: 業務運用の確信度向上** | ✅ |
| **Deploy** | **Cloudflare Pages 本番デプロイ** | ✅ |
| **v0.12.0** | **認証強化 + レビューチェック + 計算根拠強化** | ✅ **NEW** |

## API一覧

### 認証
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/auth/login` | ログイン (email + password, 初回はパスワード自動設定) |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在ユーザー情報 |
| POST | `/api/auth/change-password` | パスワード変更 |
| POST | `/api/auth/reset-request` | パスワードリセットリクエスト (SendGridメール送信) |
| POST | `/api/auth/reset-confirm` | パスワードリセット実行 (6桁コード検証) |

### 管理
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
| GET | `/api/master/rules` | ルール一覧 (?item_id, ?rule_group) |
| GET | `/api/master/rules/:id` | ルール詳細 |
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
| PATCH | `/api/projects/:id/cost-items/:itemId` | 原価明細更新 (review_status含む) |

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

## UI タブ構成 (案件詳細) - 8タブ
1. **建物条件** -- 建物情報の入力・編集 (6セクション, 自動保存, 入力補助パネル付き)
2. **工種別原価** -- 58工種の自動算出結果と手動上書き + 計算根拠モーダル（計算式・入力値マッピング付き）
3. **原価集計** -- カテゴリ別集計・総額 (日本語カテゴリ名, TOP3カード)
4. **売価・粗利** -- 売価入力 + ギャップ分析 (概念図付き)
5. **リスクセンター** -- 3段階分類 + やることTOP3
6. **再計算差分** -- 再計算時の変更点確認と承認 (4アクション)
7. **レビューチェック** -- カテゴリ別レビュー進捗 + 一括/個別ステータス変更 + プログレスバー ⭐ NEW
8. **警告・確認事項** -- タイプ別グループ化 + 条件チェック

## Data Architecture
- **Database**: Cloudflare D1 (SQLite) -- 24テーブル
- **Migrations**: 8ファイル (0001--0008)
- **Seed**: 10カテゴリ / 58工種 / 47ルール / 9システム設定 / 6ラインナップ / 4ユーザー
- **Auth**: Cookie session + CF Access + dev email bypass + SendGrid password reset
- **Enums**: 37 Zod enum definitions

## File Structure
```
src/
├── index.tsx                    # Main app, route mounting
├── types/bindings.ts           # Cloudflare bindings (DB, SendGrid, OpenAI)
├── schemas/enums.ts            # 37 Zod enum definitions
├── lib/errors.ts               # Error code policy (400-500)
├── middleware/auth.ts           # resolveUser + requireRole
├── engine/
│   ├── snapshotGenerator.ts    # Initial snapshot generation
│   └── regenerateEngine.ts     # Regeneration (3 modes) + diff
├── services/
│   └── queueService.ts         # Queue + sync fallback
└── routes/
    ├── admin.ts                # Auth + User CRUD + SendGrid email + Password reset
    ├── master.ts               # Master data API
    ├── projects.ts             # Project CRUD + access control
    ├── snapshots.ts            # Snapshot + Diffs API
    ├── costItems.ts            # Cost item update + review
    ├── salesEstimates.ts       # Sales estimate + gap
    ├── riskCentre.ts           # Risk centre aggregation
    ├── ai.ts                   # AI Phase 1
    └── ui.ts                   # Frontend UI (8-tab detail, review checklist, formula modal)
migrations/
├── 0001_initial_schema.sql
├── 0002_cr01_cr02_tables_and_columns.sql
├── 0003_warnings_source_status.sql
├── 0004_diff_resolution_columns.sql
├── 0005_ai_warnings_read_status.sql
├── 0006_auth_and_admin.sql
├── 0007_lineups_master_and_nullable_project_lineup.sql
└── 0008_password_reset_token.sql
```

## Deployment
- **Platform**: Cloudflare Pages
- **Production URL**: https://hiramatsu-cost-8ly.pages.dev
- **D1 Database**: hiramatsu-cost-production (a3d11cee-6bbd-4271-8b96-6dbf0e1fec03, ENAM)
- **Secrets**: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL (設定済み)
- **Status**: ✅ Active (Production)
- **Last Updated**: 2026-03-09
- **Version**: 0.12.0

## 使い方（初期セットアップ）
1. https://hiramatsu-cost-8ly.pages.dev/ui/login にアクセス
2. ログイン（admin@hiramatsu.example.com で任意のパスワード4文字以上を設定 → 初回パスワードとなる）
3. 「案件を作成」ボタンで新規案件を作成
4. 建物条件タブで建物情報を入力
5. 「初期計算」ボタンで原価を自動算出
6. 各タブで結果を確認・修正
7. レビューチェックタブでカテゴリ別に工種をレビュー
8. パスワードを忘れた場合はログイン画面の「パスワードを忘れた方」からリセット

## 登録ユーザー（本番環境）
| Email | Role | 名前 |
|-------|------|------|
| admin@hiramatsu.example.com | admin | System Admin |
| manager@hiramatsu.example.com | manager | テスト管理者 |
| estimator@hiramatsu.example.com | estimator | テスト見積担当 |
| viewer@hiramatsu.example.com | viewer | テスト閲覧者 |

## E2Eテスト結果 (SHIN, 32坪)
- 総原価: ¥7,889,153
- 最大カテゴリ: 木工事 ¥3,090,000 (39%)
- 売価設定: ¥11,200,000 → 粗利 ¥3,310,847 (約29.6%)
- 警告: 10件（手動確認必要: 3, 金額0円: 3, 注意事項: 4）

## Next Steps
- [ ] 実案件での通しテスト（平松建築の実案件データで計算精度を検証）
- [ ] 計算根拠モーダルの微調整（実データに基づく表示改善）
- [ ] AI Phase 2: GPT-4o直接接続強化
- [ ] Cloudflare Access 認証設定（本番セキュリティ強化）
- [ ] CR-06: バッチレビュー
- [ ] CR-07: CSVエクスポート
- [ ] lineup_packages / lineup_option_groups テーブルの活用（Phase 2 予約）
