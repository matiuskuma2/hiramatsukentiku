# 平松建築 原価管理システム (hiramatsu-cost)

## Project Overview
- **Name**: hiramatsu-cost
- **Goal**: 平松建築の住宅コスト見積もりを自動化する原価管理システム
- **Phase**: Step 4 完了 (Sales Estimate / Risk Centre / AI Phase 1 / Frontend UI)
- **Stack**: Hono + TypeScript + Cloudflare D1 + TailwindCSS + Alpine.js

## URLs
- **Sandbox**: https://3000-ir9zs5r25rb1al74y1qzm-3844e1b6.sandbox.novita.ai
- **UI**: /ui/projects (案件一覧), /ui/projects/:id (詳細 + リスクセンター)
- **API Health**: /api/health

## 完了済みステップ
| Step | 内容 | Status |
|------|-------|--------|
| Step 0 | Spike検証 (D1, Queue, Batch, Index, TX) | ✅ |
| Step 1 | DBスキーマ25テーブル + Seed (58 items, 47 rules, 10 categories) | ✅ |
| Step 2 | マスタ参照API + Project API + Snapshot Engine | ✅ |
| Step 2.5 | status遷移修正 + warnings shape + error code policy + sync_fallback | ✅ |
| Step 3 | Regenerate 3モード + Diff Resolution + 工種詳細Update + M3 milestone | ✅ |
| Step 4 | Sales Estimate + Risk Centre + AI Phase 1 + Frontend UI + M4 milestone | ✅ |

## API一覧

### Master Data
| Method | Path | 権限 | 説明 |
|--------|------|------|------|
| GET | /api/master/categories | all | カテゴリ一覧 (10件) |
| GET | /api/master/items | all | マスタ明細一覧 (58件) |
| GET | /api/master/items/:id | all | 明細詳細 (versions, rules含む) |
| GET | /api/master/system-settings | all | システム設定 (9件) |
| GET | /api/master/users | all | ユーザー一覧 |

### Projects
| Method | Path | 権限 | 説明 |
|--------|------|------|------|
| GET | /api/projects | all | 案件一覧 (?status, ?page, ?per_page) |
| GET | /api/projects/:id | all | 案件詳細 |
| POST | /api/projects | estimator+ | 案件作成 |

### Snapshots
| Method | Path | 権限 | 説明 |
|--------|------|------|------|
| POST | /api/projects/:id/snapshots/enqueue | estimator+ | スナップショット生成 (initial/regenerate_*) |
| GET | /api/projects/:id/snapshots | all | スナップショット一覧 |
| GET | /api/projects/:id/snapshots/:snapshotId | all | スナップショット詳細 (items, summaries, warnings) |
| GET | /api/projects/:id/snapshots/jobs/:jobId | all | ジョブ状態 |

### Regeneration & Diffs
| Method | Path | 権限 | Default Mode | 409条件 | 422条件 |
|--------|------|------|-------------|---------|---------|
| POST | .../enqueue (preserve_reviewed) | estimator+ | ✅ default | unresolved diff, active job | no snapshot |
| POST | .../enqueue (auto_only) | estimator+ | - | unresolved diff, active job | no snapshot |
| POST | .../enqueue (replace_all) | manager+ | - | active job | no snapshot |
| GET | /api/projects/:id/diffs | all | - | - | - |
| POST | /api/projects/:id/diffs/:diffId/resolve | estimator+ | - | already resolved | - |
| POST | /api/projects/:id/diffs/resolve-all | manager+ | - | - | - |

### Cost Items (工種詳細)
| Method | Path | 権限 | 説明 |
|--------|------|------|------|
| PATCH | /api/projects/:id/cost-items/:itemId | estimator+ | 手修正 (quantity/price/amount/reason/review_status) |
| POST | /api/projects/:id/cost-items/:itemId/review | manager+ | レビューステータス変更 |

### Sales Estimates (Step 4.1)
| Method | Path | 権限 | 説明 |
|--------|------|------|------|
| POST | /api/projects/:id/sales-estimates | estimator+ | 売価見積もり作成 + gap計算 + warning生成 |
| GET | /api/projects/:id/sales-estimates | all | 見積もり一覧 (?estimate_type, ?current_only) |
| GET | /api/projects/:id/sales-estimates/:estimateId | all | 見積もり詳細 + gap分析 |
| PATCH | /api/projects/:id/sales-estimates/:estimateId | estimator+ | 見積もり更新 + gap再計算 |
| GET | /api/projects/:id/gap-analysis | all | 現在の乖離分析 |

### Risk Centre (Step 4.2)
| Method | Path | 権限 | 説明 |
|--------|------|------|------|
| GET | /api/projects/:id/risk-centre | all | リスクセンター (集約エンドポイント) |

**Risk Centre返却フィールド:**
- summary: risk_level, risk_score, error/warning/info counts
- input_completion: overall_rate, required_rate, unset fields
- sales_gap: margin, deviation, cost vs sale
- regeneration_diffs: unresolved, significant, total_change
- review_progress: confirmed, pending, needs_review, flagged
- risks[]: id, category, severity, title, description, action_required
- warning_summary: ai, system, regeneration, manual counts

### AI Phase 1 (Step 4.3)
| Method | Path | 権限 | Mode | 説明 |
|--------|------|------|------|------|
| POST | /api/ai/check-conditions | estimator+ | rule_based / ai_enhanced | 条件チェック (unmet conditions) |
| POST | /api/ai/classify-override-reason | estimator+ | keyword_matching / ai_enhanced | 理由分類 |
| POST | /api/ai/parse-document | estimator+ | pattern_matching / ai_enhanced | 書類解析 |
| GET | /api/ai/status | all | - | AI機能ステータス |

**AI Phase 1 特徴:**
- OPENAI_API_KEY未設定時: ルールベース/パターンマッチで動作
- 結果は参照用のみ、自動反映なし (staging)
- Phase 2で自動反映機能を実装予定

### Frontend UI (Step 4.4)
| Path | 説明 |
|------|------|
| /ui/projects | 案件一覧 (フィルタ、新規作成) |
| /ui/projects/:id | 案件詳細 (5タブ: リスクセンター, 工種明細, 差分解決, 原価サマリ, 売価見積) |

## Error Code Mapping
| HTTP | Code | 用途 |
|------|------|------|
| 400 | VALIDATION_ERROR | 入力エラー |
| 401 | UNAUTHENTICATED | 認証なし |
| 403 | INSUFFICIENT_PERMISSION | 権限不足 |
| 404 | NOT_FOUND | リソース未検出 |
| 409 | CONFLICT / DUPLICATE_ENQUEUE / STATE_MISMATCH / OPTIMISTIC_LOCK_CONFLICT | 競合 |
| 422 | BUSINESS_RULE_VIOLATION | ビジネスルール違反 |
| 500 | INTERNAL_ERROR | 内部エラー |

## Sales Comparison Thresholds (system_settings)
| Key | Value | 説明 |
|-----|-------|------|
| sales_gap_warning_threshold | 10% | 粗利率乖離のwarning閾値 |
| sales_gap_error_threshold | 20% | 粗利率乖離のerror閾値 |
| default_standard_margin_rate | 30% | 期待標準粗利率 |
| default_solar_margin_rate | 25% | 期待太陽光粗利率 |
| default_option_margin_rate | 30% | 期待オプション粗利率 |

## Warning Rules
1. **売価入力** → gap計算 → 期待粗利率との乖離を判定
2. 乖離 ≥ warning_threshold (10%) → severity: warning
3. 乖離 ≥ error_threshold (20%) → severity: error
4. 売価 < 原価 → severity: error (negative margin)
5. 売価更新時 → warning自動更新/解除
6. OK範囲に戻った場合 → warning resolved

## Data Architecture
- **Database**: Cloudflare D1 (SQLite) — 25テーブル
- **Storage**: project_cost_snapshots, project_cost_items, project_cost_summaries
- **Warnings**: project_warnings (source: system/ai/regeneration/manual)
- **Sales**: project_sales_estimates (estimate_type: rough/internal/contract/execution)
- **Diffs**: project_cost_regeneration_diffs (resolution_status: pending/adopted/kept/dismissed/manual_adjusted)
- **Queue**: Cloudflare Queue + sync_fallback
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
    ├── master.ts               # Master data API
    ├── projects.ts             # Project CRUD
    ├── snapshots.ts            # Snapshot + Diffs API
    ├── costItems.ts            # Cost item update + review
    ├── salesEstimates.ts       # Sales estimate CRUD + gap analysis
    ├── riskCentre.ts           # Risk centre aggregation
    ├── ai.ts                   # AI Phase 1 stubs
    └── ui.ts                   # Frontend UI (Alpine.js + TailwindCSS)
```

## M4 Milestone Results
1案件のフロー: project作成 → snapshot生成 → 売価入力 → gap warning → risk centre → AI check → 売価修正 → warning解除

| ステップ | 結果 |
|---------|------|
| Project作成 (draft) | ✅ ID=9907 |
| 初期Snapshot (58 items, 17 warnings) | ✅ total_cost=¥4,900,040 |
| 売価入力 (5%マージン) | ✅ margin=4.76%, severity=error |
| sales_estimate_gap warning生成 | ✅ 1件生成 |
| Risk Centre集約 | ✅ level=high, score=27, errors=2, warnings=2 |
| AI check-conditions | ✅ 47ルール, 25件unmet (rule_based) |
| AI classify-override-reason | ✅ category=site_condition, confidence=0.7 |
| AI parse-document | ✅ 4項目抽出, ¥3,250,000 |
| 売価修正 (35%マージン) | ✅ severity=ok, margin=35.48% |
| Risk Centre再確認 | ✅ level=medium, score=7 (sales gap解消) |

## Regression Test Results
- Master: categories=10, items=58, settings=9 ✅
- Queue: 8/8 ALL_PASS ✅
- Sales API: CRUD + gap + warning ✅
- Risk Centre: aggregation ✅
- AI: 3 endpoints active ✅
- UI: /ui/projects 200, /ui/projects/:id 200 ✅

## Next Steps
- [ ] CR absorption (CR-01~07)
- [ ] AI Phase 2: OPENAI_API_KEY連携, 自動反映
- [ ] Frontend: 工種明細の編集モーダル, diff resolution UI強化
- [ ] Cloudflare Pages本番デプロイ
- [ ] E2Eテスト

## Deployment
- **Platform**: Cloudflare Pages (local dev with wrangler)
- **Status**: ✅ Active (Sandbox)
- **Last Updated**: 2026-03-08
