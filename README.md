# 平松建築 見積原価システム (Hiramatsu Cost)

## Project Overview
- **Name**: hiramatsu-cost
- **Goal**: 平松建築の見積原価管理をシステム化。マスターデータに基づく自動原価計算・スナップショット管理・レビューワークフロー
- **Phase**: Step 3 完了 (M3 マイルストーン通過)

## Current Status (2026-03-08)

### Completed
- **Step 0 (Spike)**: D1技術検証 11/11 PASS, Queue production test 8/8 PASS
- **Step 1-A**: DB Schema 25テーブル確定, Seed投入 (items=58, versions=58, rules=47, categories=10)
- **Step 2**: マスタ参照API, Project API, Snapshot生成エンジン
- **Step 2.5**: project.status遷移修正, warnings shape確定, APIエラーコード規約, sync_fallback統一
- **Step 3**: Regenerate API (3モード), Diff Resolution API, Work-type Detail Update API, M3 full cycle PASS

### M3 Milestone Results
```
regenerate → diff generation → diff resolution → re-validation: PASS
  - Regenerate (preserve_reviewed): 4 preserved, 54 recalculated, 2 diffs detected
  - Diff resolve (adopt_candidate): status=adopted, review=needs_review ✅
  - Diff resolve (manual_adjust): status=manual_adjusted, amount=200,000 ✅
  - Diff resolve (duplicate): 409 STATE_MISMATCH ✅
  - All diffs resolved: pending=0 ✅
  - Work-type update: final=500,000, revision_no incremented ✅
  - Summary/Snapshot recalculated in same TX ✅
```

### API Endpoints

| Path | Method | Permission | Description |
|------|--------|------------|-------------|
| `/api/health` | GET | public | Health check |
| `/api/master/categories` | GET | viewer+ | カテゴリ一覧 (10件) |
| `/api/master/categories/:code` | GET | viewer+ | カテゴリ詳細 + items数 |
| `/api/master/items` | GET | viewer+ | マスタ項目一覧 (58件) |
| `/api/master/items?category=foundation` | GET | viewer+ | カテゴリ絞込 |
| `/api/master/items/:id` | GET | viewer+ | マスタ項目詳細 |
| `/api/master/items/:id/versions` | GET | viewer+ | 版履歴 |
| `/api/master/rules?item_id=xxx` | GET | viewer+ | ルール一覧 |
| `/api/master/system-settings` | GET | admin/manager | システム設定 (9件) |
| `/api/master/users` | GET | admin | ユーザー一覧 |
| `/api/master/users/me` | GET | viewer+ | 自分の情報 |
| `/api/projects` | GET | viewer+ | プロジェクト一覧 |
| `/api/projects/:id` | GET | viewer+ | プロジェクト詳細 |
| `/api/projects` | POST | estimator+ | プロジェクト作成 |
| `/api/projects/:id/snapshots/enqueue` | POST | estimator+ | スナップショット生成/再生成 |
| `/api/projects/:id/snapshots` | GET | viewer+ | スナップショット一覧 |
| `/api/projects/:id/snapshots/:snapshotId` | GET | viewer+ | スナップショット詳細 |
| `/api/projects/:id/snapshots/jobs/:jobId` | GET | viewer+ | ジョブ状態 |
| `/api/projects/:id/diffs` | GET | viewer+ | Diff一覧 (?snapshot_id, ?significant_only, ?category, ?status) |
| `/api/projects/:id/diffs/:diffId/resolve` | POST | estimator+ | Diff解決 (adopt/keep/dismiss/manual_adjust) |
| `/api/projects/:id/diffs/resolve-all` | POST | manager+ | 一括Diff解決 (keep_current/dismiss) |
| `/api/projects/:id/cost-items/:itemId` | PATCH | estimator+ | 工種詳細更新 (手修正/理由/review_status) |
| `/api/projects/:id/cost-items/:itemId/review` | POST | manager+ | レビュー状態変更 |

### Regenerate API (Step 3)

| job_type | Default | Permission | 動作 |
|----------|---------|------------|------|
| `regenerate_preserve_reviewed` | ✅ default | estimator+ | confirmed明細を保持、pending明細を再計算 |
| `regenerate_auto_only` | | estimator+ | auto列のみ再計算、manual override保持 |
| `regenerate_replace_all` | | manager+ | 全明細を新規再計算 (confirmed/manual含む) |

**409 conditions**: unresolved diffs exist (preserve_reviewed/auto_only), active job already running
**422 conditions**: initial with existing snapshot, regenerate without snapshot

### Diff Resolution API (Step 3)

| action | resolution_status | review_status変更 | 明細への影響 |
|--------|-------------------|-------------------|-------------|
| `adopt_candidate` | adopted | → needs_review | final = auto値に戻す |
| `keep_current` | kept | 変更なし | 変更なし |
| `dismiss` | dismissed | 変更なし | 変更なし |
| `manual_adjust` | manual_adjusted | → needs_review | final = manual_amount |

**State rules**: already resolved → 409 STATE_MISMATCH; superseded snapshot → 422

### Work-type Detail Update (Step 3)

同一トランザクションで実行:
1. `project_cost_items` の明細更新 (manual_quantity/price/amount, reason, review_status)
2. `project_cost_summaries` のカテゴリ合計再計算
3. `project_cost_snapshots` の総額再計算
4. `projects.revision_no` インクリメント
5. `project_audit_logs` 監査ログ
6. 20%超の変動時 → `project_warnings` に警告追加

### API Error Code Policy (Step 2.5-D)

| HTTP | Error Code | 説明 |
|------|------------|------|
| 400 | VALIDATION_ERROR | リクエスト不正 |
| 401 | UNAUTHENTICATED | 認証なし |
| 403 | INSUFFICIENT_PERMISSION | 権限不足 |
| 404 | NOT_FOUND | リソース不在 |
| 409 | CONFLICT / DUPLICATE_ENQUEUE / STATE_MISMATCH | 競合・重複・状態不整合 |
| 422 | BUSINESS_RULE_VIOLATION | ビジネスルール違反 |
| 500 | INTERNAL_ERROR | サーバーエラー |

### Data Architecture
- **Database**: Cloudflare D1 (SQLite) — 25+ tables
- **Storage**: project_cost_snapshots, project_cost_items, project_cost_summaries, project_warnings, project_cost_regeneration_diffs
- **Queue**: Cloudflare Queue (sync_fallback in local dev)
- **Auth**: CF Access + DEV_USER_EMAIL bypass
- **Enums**: 37 Zod enum definitions

### Status Transition
```
draft → calculating (enqueue時) → in_progress (snapshot完了時)
                                 → draft (失敗時=元のstatusに復元)
in_progress → needs_review → reviewed → archived
```

### Diff Lifecycle
```
regenerate → diffs created (resolution_status=pending)
  → adopt_candidate / keep_current / dismiss / manual_adjust
  → all resolved (pending=0) → ready for next regeneration
```

## File Structure
```
src/
├── index.tsx              # Main app + Spike test routes
├── types/bindings.ts      # Cloudflare bindings types
├── schemas/enums.ts       # Zod enum definitions (37 enums)
├── lib/errors.ts          # API error code factory
├── middleware/auth.ts      # CF Access + role RBAC
├── routes/
│   ├── master.ts          # Master reference API (GET only)
│   ├── projects.ts        # Project CRUD
│   ├── snapshots.ts       # Snapshot enqueue/detail + Diff resolution
│   └── costItems.ts       # Work-type detail update + Review
├── engine/
│   ├── snapshotGenerator.ts  # Initial snapshot generation
│   └── regenerateEngine.ts   # Regeneration engine (shadow snapshot + diff)
└── services/
    └── queueService.ts    # Queue abstraction (real/sync fallback)

migrations/
├── 0001_initial_schema.sql
├── 0002_cr01_cr02_tables_and_columns.sql
├── 0003_warnings_source_status.sql
└── 0004_diff_resolution_columns.sql
```

## Deployment
- **Platform**: Cloudflare Pages
- **Tech Stack**: Hono + TypeScript + D1 + TailwindCSS
- **Version**: 0.3.1-step3
- **Last Updated**: 2026-03-08

## Next Steps (Step 4)
1. CR absorption (CR-01 ~ CR-07)
2. AI連携 (OpenAI による自動見積もり提案)
3. Sales estimate comparison API
4. Frontend UI scaffolding
