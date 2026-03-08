# 平松建築 概算原価管理システム (hiramatsu-cost)

## Project Overview
- **Name**: hiramatsu-cost
- **Version**: 0.8.0-step8
- **Goal**: 平松建築の注文住宅 概算原価を自動算出し、売価ギャップ分析・リスク可視化を行う原価管理システム
- **Phase**: Step 8 完了 (CR-03/CR-05修正 + デプロイ準備文書 + M8統合テストPASS)
- **Stack**: Hono + TypeScript + Cloudflare D1 + TailwindCSS + Alpine.js

## URLs
- **Sandbox**: https://3000-ir9zs5r25rb1al74y1qzm-3844e1b6.sandbox.novita.ai
- **UI**: `/ui/projects` (案件一覧), `/ui/projects/:id` (詳細 7タブ)
- **API Health**: `/api/health`
- **AI Status**: `/api/ai/status`

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

## CR (Change Request) 対応状況

| CR | 内容 | Status |
|----|------|--------|
| CR-01 | テーブル・カラム追加 (0002マイグレーション) | ✅ |
| CR-02 | audit_log target_type拡張 | ✅ |
| CR-03 | system-settings PATCH JSONパースエラー修正 | ✅ Step 8 |
| CR-04 | Queue本番レベルテスト (8/8 PASS) | ✅ |
| CR-05 | プロジェクト編集画面 (PATCH + UI inline edit) | ✅ Step 8 |
| CR-06 | バッチレビュー | ⏳ 未着手 |
| CR-07 | CSVエクスポート | ⏳ 未着手 |

## API一覧

### ヘルス・システム
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/health` | ヘルスチェック (version, phase) |

### マスタデータ
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/master/categories` | カテゴリ一覧 (10件) |
| GET | `/api/master/categories/:code` | カテゴリ詳細 |
| GET | `/api/master/items` | 工種一覧 (58件, ?category, ?active_only) |
| GET | `/api/master/items/:id` | 工種詳細 |
| GET | `/api/master/items/:id/versions` | 工種バージョン履歴 |
| GET | `/api/master/rules` | ルール条件一覧 (?item_id, ?rule_group) |
| GET | `/api/master/system-settings` | システム設定一覧 (9件) |
| PATCH | `/api/master/system-settings/:key` | システム設定更新 **(CR-03修正済)** |
| GET | `/api/master/users` | ユーザー一覧 |
| GET | `/api/master/users/me` | 現在のユーザー |

### プロジェクト
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/projects` | 案件一覧 (?status, ?page, ?per_page) |
| GET | `/api/projects/:id` | 案件詳細 |
| POST | `/api/projects` | 案件作成 |
| PATCH | `/api/projects/:id` | 案件編集 **(CR-05実装済)** |

### スナップショット
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/projects/:id/snapshots` | スナップショット一覧 |
| POST | `/api/projects/:id/snapshots` | スナップショット生成 |
| POST | `/api/projects/:id/snapshots/regenerate` | 再計算 (3モード) |

### 原価明細
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/projects/:id/cost-items` | 原価明細一覧 |
| PATCH | `/api/projects/:id/cost-items/:itemId` | 原価明細更新 (手動上書き) |
| GET | `/api/projects/:id/cost-summaries` | 原価集計 |

### 差分解決
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/projects/:id/diffs` | 差分一覧 |
| PATCH | `/api/projects/:id/diffs/:diffId` | 差分解決 (accept/reject/manual) |

### 売価見積
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/projects/:id/sales-estimate` | 売価見積作成 |
| GET | `/api/projects/:id/gap-analysis` | ギャップ分析 |

### リスクセンター
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/projects/:id/risk-centre` | リスクサマリー |

### AI
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/ai/status` | AI稼働状態 (mode, degradation, available) |
| POST | `/api/ai/check-conditions` | 条件チェック (47ルール判定) |
| POST | `/api/ai/classify-override-reason` | 変更理由分類 |
| POST | `/api/ai/parse-document` | 書類解析 (text/PDF/CSV) |
| GET | `/api/ai/warnings/:projectId` | 警告一覧 + サマリー |
| PATCH | `/api/ai/warnings/:warningId` | 警告更新 (read/resolve/ignore/reopen) |

### UI
| Path | 説明 |
|------|------|
| `/ui/projects` | 案件一覧 (フィルタ、新規作成) |
| `/ui/projects/:id` | 案件詳細 (7タブ) |

## UI 7タブ構成
1. **プロジェクト編集** (CR-05) — lineup/坪数/面積/断熱等級/防火条件/屋根形状/顧客名/自治体のインライン編集
2. **リスクセンター** — 入力充足率・リスクスコア・アクション要否
3. **原価明細** — 58工種の自動算出結果と手動上書きモーダル
4. **差分解決** — 再計算時の変更点確認と承認
5. **原価集計** — カテゴリ別集計・総額
6. **売価見積** — 売価入力 + ギャップ分析ビジュアライゼーション
7. **AI & 警告** — AIステータス・条件チェック・警告CRUD・PDF読取

## AI モード切替
| 条件 | mode | ui表示 |
|------|------|--------|
| OPENAI_API_KEY 設定済み | `ai_enhanced` | 緑ステータスカード |
| OPENAI_API_KEY 未設定 | `rule_based` | 黄バナー (graceful degradation) |

全エンドポイントはキー有無に関わらず正常動作。

## 売価ギャップ判定ロジック
- `margin_deviation = expected_margin - actual_margin`
- 正値 (e.g. +15%) → マージン不足 → warning/error
- 負値 (e.g. -14.59%) → 高マージン → OK
- 閾値: warning ≥ 10%, error ≥ 20% (system_settings で調整可能)

## Data Architecture
- **Database**: Cloudflare D1 (SQLite) — 23テーブル
- **Migrations**: 5ファイル (0001〜0005)
- **Seed**: 10カテゴリ / 58工種 / 47ルール / 9システム設定
- **Queue**: sync_fallback (8/8 PASS) — 本番Queueは将来有効化
- **Auth**: CF Access + dev email bypass
- **Enums**: 37 Zod enum definitions

## File Structure
```
src/
├── index.tsx                    # Main app, spike tests, route mounting
├── types/bindings.ts           # Cloudflare bindings, AppEnv, ApiResponse
├── schemas/enums.ts            # 37 Zod enum definitions
├── lib/errors.ts               # Error code policy (400-500)
├── middleware/auth.ts           # resolveUser + requireRole
├── engine/
│   ├── snapshotGenerator.ts    # Initial snapshot generation
│   └── regenerateEngine.ts     # Regeneration (3 modes) + diff generation
├── services/
│   └── queueService.ts         # Queue + sync fallback
└── routes/
    ├── master.ts               # Master data API + settings PATCH (CR-03)
    ├── projects.ts             # Project CRUD + PATCH edit (CR-05)
    ├── snapshots.ts            # Snapshot + Diffs API
    ├── costItems.ts            # Cost item update + review
    ├── salesEstimates.ts       # Sales estimate CRUD + gap analysis
    ├── riskCentre.ts           # Risk centre aggregation
    ├── ai.ts                   # AI Phase 1 (production-hardened)
    └── ui.ts                   # Frontend UI (Alpine.js + TailwindCSS)
docs/
├── 01_operation_manual.md      # 運用手順書
├── 02_rollback_procedure.md    # 障害時切り戻し手順書
└── 03_infrastructure_settings.md # 本番インフラ設定一覧
migrations/
├── 0001_initial_schema.sql     # 23テーブル + インデックス + シード
├── 0002_cr01_cr02_tables_and_columns.sql
├── 0003_warnings_source_status.sql
├── 0004_diff_resolution_columns.sql
└── 0005_ai_warnings_read_status.sql
```

## M8 統合テスト結果 (E2E フルフロー)

| ステップ | 結果 |
|---------|------|
| 案件作成 (M8-FLOW, tsubo=35.5) | ✅ ID=9910 |
| 案件編集 (prefecture=静岡県, has_pv=1) | ✅ PATCH成功 |
| 初期Snapshot (58 items) | ✅ total_cost=¥4,938,710 |
| 売価見積 (margin=5.02%) | ✅ deviation=24.98%, severity=error |
| リスクセンター | ✅ level=high, score=27, risks=5 |
| スナップショット再生成 | ✅ 成功 |
| AI条件チェック (ai_enhanced) | ✅ 24 unmet / 47 rules |
| AI警告 | ✅ 17 total, all open |
| システム設定更新 (CR-03) | ✅ PATCH成功 → revert成功 |
| UI画面表示 | ✅ 2/2 pages (list + detail) |
| Queue本番テスト | ✅ 8/8 PASS |

## デプロイ準備文書

| 文書 | パス | 内容 |
|------|------|------|
| 運用手順書 | `docs/01_operation_manual.md` | 日常運用・案件フロー・監視・デプロイ手順 |
| 切り戻し手順書 | `docs/02_rollback_procedure.md` | ロールバック判断基準・コード/DB/Secret復旧手順 |
| インフラ設定一覧 | `docs/03_infrastructure_settings.md` | D1/Queue/Access/Secrets/API全一覧・チェックリスト |

## Deployment
- **Platform**: Cloudflare Pages (local dev with wrangler)
- **Status**: ✅ Active (Sandbox) / 本番デプロイ準備完了
- **Last Updated**: 2026-03-08
- **Version**: 0.8.0-step8

## Next Steps
- [ ] Cloudflare Pages 本番デプロイ実行 (D1作成 → マイグレーション → Secret → デプロイ)
- [ ] AI Phase 2: GPT-4o直接接続、条件チェック強化、OCR連携
- [ ] CR-06: バッチレビュー
- [ ] CR-07: CSVエクスポート
- [ ] Cloudflare Access 認証設定
- [ ] Queue バインディング有効化 (高負荷対応)
