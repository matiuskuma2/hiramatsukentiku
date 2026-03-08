# 平松建築 見積原価システム (Hiramatsu Cost)

## Project Overview
- **Name**: hiramatsu-cost
- **Goal**: 平松建築の見積原価管理をシステム化。マスターデータに基づく自動原価計算・スナップショット管理・レビューワークフロー
- **Phase**: Step 2.5 完了 (API基盤整備完了)

## Current Status (2026-03-08)

### Completed
- **Step 0 (Spike)**: D1技術検証 11/11 PASS, Queue production test 8/8 PASS
- **Step 1-A**: DB Schema 25テーブル確定, Seed投入 (items=58, versions=58, rules=47, categories=10)
- **Step 2**: マスタ参照API, Project API, Snapshot生成エンジン
- **Step 2.5**: project.status遷移修正, warnings shape確定, APIエラーコード規約, sync_fallback統一

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
| `/api/projects/:id/snapshots/enqueue` | POST | estimator+ | スナップショット生成 |
| `/api/projects/:id/snapshots` | GET | viewer+ | スナップショット一覧 |
| `/api/projects/:id/snapshots/:snapshotId` | GET | viewer+ | スナップショット詳細 |
| `/api/projects/:id/snapshots/jobs/:jobId` | GET | viewer+ | ジョブ状態 |

### API Error Code Policy (Step 2.5-D)

| HTTP | Error Code | 説明 |
|------|------------|------|
| 400 | VALIDATION_ERROR | リクエスト不正 |
| 401 | UNAUTHENTICATED | 認証なし |
| 403 | INSUFFICIENT_PERMISSION | 権限不足 |
| 404 | NOT_FOUND | リソース不在 |
| 409 | CONFLICT / DUPLICATE_ENQUEUE | 競合・重複 |
| 422 | BUSINESS_RULE_VIOLATION | ビジネスルール違反 |
| 500 | INTERNAL_ERROR | サーバーエラー |

### Data Architecture
- **Database**: Cloudflare D1 (SQLite) — 25 tables
- **Storage**: project_cost_snapshots, project_cost_items, project_cost_summaries, project_warnings
- **Queue**: Cloudflare Queue (sync_fallback in local dev)
- **Auth**: CF Access + DEV_USER_EMAIL bypass

### Status Transition (Step 2.5-A)
```
draft → calculating (enqueue時) → in_progress (snapshot完了時)
                                 → draft (失敗時=元のstatusに復元)
in_progress → needs_review → reviewed → archived
```

### Warnings Shape (Step 2.5-C)
```json
{
  "warning_type": "manual_required",
  "severity": "warning",
  "source": "system",
  "status": "open",
  "message": "...",
  "recommendation": "...",
  "detail_json": "{...}"
}
```

## File Structure
```
src/
├── index.tsx              # Main app + Spike test routes
├── types/bindings.ts      # Cloudflare bindings types
├── schemas/enums.ts       # Zod enum definitions (35 enums)
├── lib/errors.ts          # API error code factory
├── middleware/auth.ts      # CF Access + role RBAC
├── routes/
│   ├── master.ts          # Master reference API (GET only)
│   ├── projects.ts        # Project CRUD
│   └── snapshots.ts       # Snapshot enqueue + detail
├── engine/
│   └── snapshotGenerator.ts  # Snapshot generation engine
└── services/
    └── queueService.ts    # Queue abstraction (real/sync fallback)
```

## Deployment
- **Platform**: Cloudflare Pages
- **Tech Stack**: Hono + TypeScript + D1 + TailwindCSS
- **Last Updated**: 2026-03-08

## Next Steps (Step 3)
1. Regenerate APIs (regenerate_preserve_reviewed, regenerate_auto_only, regenerate_replace_all)
2. Diff resolution UI APIs
3. Work-type detail update APIs
4. CR absorption (CR-01 ~ CR-07)
