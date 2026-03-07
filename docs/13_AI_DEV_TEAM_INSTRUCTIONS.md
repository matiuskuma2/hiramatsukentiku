# AI 駆動開発チーム向け 実装指示書（ドラフト）

> **目的**: AI コーディングアシスタント（Cursor / Claude Code / Copilot 等）が、本プロジェクトの設計ドキュメントを正確に理解し、整合性のある実装を行うためのガイド。
> **前提**: すべての設計判断は完了済み。本ドキュメントは「何をどの順序で実装するか」の指示に集中する。

---

## 1. プロジェクト概要（実装者向け要約）

**システム名**: 平松建築 概算原価管理システム
**技術スタック**: Cloudflare Pages + Workers + Hono + D1 + R2
**認証**: Cloudflare Access (Zero Trust) + app_users テーブル
**DB**: Cloudflare D1 (SQLite), 25テーブル, CHECK制約付き
**対象ユーザー**: 社内5〜10名

**核心機能**: 住宅建築の37工種の原価を、12パターンの計算方式で自動/半自動計算し、粗利率を管理する。

---

## 2. 必読ドキュメント一覧（優先度順）

実装前に必ず読むべきドキュメント:

| 優先度 | ドキュメント | 読む理由 |
|--------|------------|---------|
| **必須** | `11_ENUM_STATUS_SPEC.md` | 全 enum 値、CHECK 制約、Zod スキーマ。実装の型定義の根拠 |
| **必須** | `01_DB_SCHEMA_DESIGN_v4.md` | DB設計（25テーブル）。テーブル構造と関係性 |
| **必須** | `12_MIGRATION_SQL_FINAL.md` | マイグレーションSQL。そのまま適用可能 |
| **必須** | `02_COST_CALCULATION_DEFINITIONS_v2.md` | 37工種の計算ロジック。計算エンジンの根拠 |
| **高** | `03_SCREEN_DESIGN_v2.md` | API設計・画面設計。エンドポイント一覧 |
| **高** | `05_MASTER_DATA_PLAN_v3.md` | シードデータ構造とバリデーション仕様 |
| **高** | `06_PHASE1_IMPLEMENTATION_PLAN_v2.md` | 実装ステップと工数見積もり |
| **中** | `09_CROSS_REVIEW_PHASE2.md` | 既知の問題点と解決方針 |
| **中** | `10_IMPLEMENTATION_READINESS_CHECKLIST.md` | 実装前ブロッカーチェック |
| **低** | その他（00, 04, 07, 08） | 背景情報・参考 |

---

## 3. 実装の鉄則（違反厳禁）

### 3-1. 型安全

```typescript
// ✅ 必ず 11_ENUM_STATUS_SPEC.md の Zod スキーマを使用
import { ProjectStatus, Lineup, CalculationType } from '../schemas/enums';

// ❌ 文字列リテラルを直書きしない
const status = 'draft'; // 型チェックが効かない
```

### 3-2. DB 操作

- **全 enum カラムに CHECK 制約がある** — 不正値を INSERT すると SQLite がエラーを返す
- **Boolean は INTEGER (1/0)** — `true`/`false` は使えない
- **TEXT PK** — `cost_categories`, `cost_master_items`, `cost_master_item_versions`, `cost_rule_conditions` は TEXT 型 PK
- **バッチ100件制限** — D1 のバッチ処理は最大100文。分割必須
- **楽観ロック** — `projects`, `project_cost_items`, `project_cost_summaries` に `version` カラム。更新時は必ず `WHERE version = ?` で確認
- **FK制約はアプリ層** — D1 はデフォルト FK 無効。投入順序とアプリ層チェックで保証

### 3-3. スナップショットジョブの排他制御

```typescript
// ✅ 同一案件に対してアクティブジョブは1つだけ
const activeJobs = await db.prepare(
  `SELECT COUNT(*) as cnt FROM cost_snapshot_jobs
   WHERE project_id = ? AND status IN ('queued', 'running')`
).bind(projectId).first();

if (activeJobs.cnt > 0) {
  return c.json({ error: 'ジョブが既に実行中です' }, 409);
}
```

### 3-4. 認証

```typescript
// ✅ Cloudflare Access JWT から email を取得し app_users で照合
const email = c.req.header('CF-Access-Authenticated-User-Email');
const user = await db.prepare(
  'SELECT * FROM app_users WHERE email = ? AND status = ?'
).bind(email, 'active').first();

if (!user) return c.json({ error: 'Unauthorized' }, 403);
```

---

## 4. 実装ステップ（優先度ベース・アクションプラン）

### Phase 1-A: 基盤構築（推定 2日）

#### Step 0: 環境セットアップ

```
タスク:
  1. Hono + Cloudflare Pages プロジェクト初期化
  2. wrangler.jsonc 設定（D1バインディング）
  3. TypeScript + Zod 設定
  4. 11_ENUM_STATUS_SPEC.md の Zod スキーマを src/schemas/enums.ts に実装
  5. Git init + .gitignore

検証:
  - npm run build が成功する
  - wrangler pages dev dist が起動する
```

#### Step 1: DB + マイグレーション

```
タスク:
  1. D1 データベース作成: npx wrangler d1 create webapp-production
  2. 12_MIGRATION_SQL_FINAL.md の SQL を migrations/0001_initial_schema.sql に配置
  3. マイグレーション適用: npx wrangler d1 migrations apply webapp-production --local
  4. 検証クエリ実行（テーブル23個、system_settings 9件）

検証:
  - SELECT COUNT(*) FROM sqlite_master WHERE type='table' → 23
  - SELECT COUNT(*) FROM system_settings → 9
```

#### Step 2: シードデータ修正 + 投入

```
前提: B-01, B-02, B-03 のシード修正が完了していること

タスク:
  1. seed JSON ファイルの修正（NEW-01, 02, 03）
  2. import_seed_to_d1.ts 作成（05_MASTER_DATA_PLAN_v3.md 準拠）
     - boolean → integer 変換
     - カラム名マッピング（current_unit_price → base_unit_price 等）
     - デフォルト値補完（rule_name, valid_from, valid_to, is_active）
     - バリデーション（全項目）
  3. シードデータ投入
  4. 検証クエリ実行

検証:
  - cost_categories: 10件
  - cost_master_items: 49件
  - cost_master_item_versions: 49件
  - cost_rule_conditions: 54件
  - 参照整合性: 全 rules の master_item_id が items に存在する
```

### Phase 1-B: 認証 + API 基盤（推定 2日）

#### Step 3: 認証ミドルウェア

```
タスク:
  1. Cloudflare Access JWT 検証ミドルウェア作成
  2. app_users 照合ロジック
  3. ロールベースアクセス制御ミドルウェア（11_ENUM_STATUS_SPEC.md セクション23）
  4. admin ユーザーの手動投入

検証:
  - 未認証リクエスト → 401
  - 未登録メール → 403
  - viewer が POST /api/projects → 403
  - admin が POST /api/projects → 200
```

#### Step 4: マスタ管理 API

```
タスク:
  1. GET/POST/PUT /api/master/categories
  2. GET/POST/PUT /api/master/items（バージョン管理含む）
  3. GET/POST /api/master/items/:id/versions
  4. GET /api/master/rules
  5. GET /api/master/logs
  6. master_change_logs 自動記録
  7. GET /api/health

検証:
  - カテゴリ一覧取得で37工種が返る（10件は実データ、27件は空）
  - 明細追加時に master_change_logs に記録される
```

### Phase 1-C: 案件管理 + 計算エンジン（推定 10日 — 最重要）

#### Step 5: 案件 CRUD

```
タスク:
  1. POST /api/projects（案件コード自動採番 YYYY-NNN）
  2. GET /api/projects（ページネーション、フィルタ）
  3. GET/PUT /api/projects/:id（楽観ロック対応）
  4. ダッシュボード API

検証:
  - 案件作成で YYYY-NNN コードが採番される
  - 楽観ロック: 古い version で PUT → 409 Conflict
```

#### Step 6: 計算エンジンコア（最重要・最大工数）

```
参照ドキュメント: 02_COST_CALCULATION_DEFINITIONS_v2.md

タスク:
  1. 12種類の計算ハンドラー実装
     - fixed_amount: base_fixed_amount をそのまま使用
     - per_tsubo: tsubo × base_unit_price
     - per_m2: 参照面積 × base_unit_price
     - per_meter: 参照長さ × base_unit_price
     - per_piece: 個数 × base_unit_price
     - range_lookup: conditions_json の範囲条件で明細選択
     - lineup_fixed: lineup で固定額決定
     - rule_lookup: conditions_json + actions_json で数量算出
     - manual_quote: 手入力のみ（auto_* は空）
     - product_selection: product_catalog から選択
     - package_with_delta: 標準数量 × 単価、差額管理
     - threshold_surcharge: 基準超過分を計算
  2. JSON ルール評価エンジン
     - 型変換: boolean→INTEGER, 文字列→TEXT, 数値→REAL（11_ENUM_STATUS_SPEC.md セクション21）
     - 9種類の演算子: =, !=, >, >=, <, <=, in, not_in, between
     - 9種類のアクション: select, deselect, set_quantity, set_fixed_amount, ...
  3. 2パス計算（第1パス: 独立計算、第2パス: 工種間連動）
  4. final_* 算出ロジック（01_v4 T-01 セクション参照）
  5. D1 バッチ分割 INSERT（100件制限）
  6. project_cost_items 生成
  7. project_cost_summaries 集計
  8. project_warnings 生成

テスト案件（05_MASTER_DATA_PLAN_v3.md セクション「検証5」）:
  - テスト1: SHIN / 35坪 / 等級5 / 県内
  - テスト2: RIN / 42坪 / 等級6 / 県内
  - テスト3: MOKU_HIRAYA / 28坪 / 等級5 / 県外
  - テスト4: MOKU_OOYANE / 30坪 / 等級6 / 県外
```

#### Step 7: スナップショットジョブ

```
タスク:
  1. POST /api/projects/:id/calculate → cost_snapshot_jobs 作成
  2. ジョブ実行ロジック（同期 or Durable Objects）
  3. project_cost_snapshots 生成
  4. projects.current_snapshot_id 更新
  5. projects.revision_no インクリメント
  6. 排他制御（同一案件に同時ジョブ禁止）

再生成タイプ別の動作:
  - initial: 白紙から全明細生成
  - regenerate_preserve_reviewed: confirmed 明細は維持
  - regenerate_auto_only: auto_* のみ再計算、manual_* 保持
  - regenerate_replace_all: 全明細を白紙から再計算

差分記録:
  - project_cost_regeneration_diffs に変更内容を記録
  - diff_type の7値を使い分け
```

### Phase 1-D: フロントエンド + 仕上げ（推定 8日）

#### Step 8: 原価一覧・工種詳細画面

```
タスク:
  1. COST_OVERVIEW 画面（全37工種のサマリー表示）
  2. COST_CATEGORY 画面（工種内の明細一覧、インライン編集）
  3. 手修正 UI（override_reason 必須バリデーション）
  4. review_status の状態遷移 UI
  5. 楽観ロック衝突時の UI 対応（409 → リロード促進）
```

#### Step 9: 原価サマリー・売価見積

```
タスク:
  1. COST_SUMMARY 画面（3グループ: 標準/太陽光/オプション）
  2. 売価計算（原価 ÷ (1 - 粗利率)）
  3. project_sales_estimates への保存
  4. 売価乖離警告の自動評価（system_settings の閾値参照）
```

#### Step 10: 変更履歴・警告・仕上げ

```
タスク:
  1. CHANGE_LOG 画面
  2. 警告一覧 UI
  3. マスタ管理画面（簡易版）
  4. AI 条件チェック API（Phase 1 スコープ）
  5. 全テスト案件での突合検証
```

---

## 5. ファイル構成ガイド

```
webapp/
├── src/
│   ├── index.tsx                  # Hono エントリポイント
│   ├── schemas/
│   │   ├── enums.ts               # 11_ENUM_STATUS_SPEC.md の Zod 定義
│   │   ├── project.ts             # 案件スキーマ
│   │   ├── master.ts              # マスタスキーマ
│   │   └── cost.ts                # 原価スキーマ
│   ├── middleware/
│   │   ├── auth.ts                # Cloudflare Access 認証
│   │   └── rbac.ts                # ロールベースアクセス制御
│   ├── routes/
│   │   ├── projects.ts            # 案件 API
│   │   ├── master.ts              # マスタ API
│   │   ├── costs.ts               # 原価 API
│   │   ├── snapshots.ts           # スナップショット API
│   │   ├── admin.ts               # 管理 API
│   │   └── health.ts              # ヘルスチェック
│   ├── engine/
│   │   ├── calculator.ts          # 計算エンジンコア
│   │   ├── handlers/              # 12種類の計算ハンドラー
│   │   │   ├── fixedAmount.ts
│   │   │   ├── perTsubo.ts
│   │   │   ├── perM2.ts
│   │   │   ├── perMeter.ts
│   │   │   ├── perPiece.ts
│   │   │   ├── rangeLookup.ts
│   │   │   ├── lineupFixed.ts
│   │   │   ├── ruleLookup.ts
│   │   │   ├── manualQuote.ts
│   │   │   ├── productSelection.ts
│   │   │   ├── packageWithDelta.ts
│   │   │   └── thresholdSurcharge.ts
│   │   ├── ruleEvaluator.ts       # JSON ルール評価
│   │   ├── typeConverter.ts       # 型変換（boolean→int等）
│   │   └── snapshotJob.ts         # スナップショットジョブ
│   ├── services/
│   │   ├── projectService.ts
│   │   ├── masterService.ts
│   │   ├── costService.ts
│   │   └── warningService.ts
│   └── utils/
│       ├── d1Batch.ts             # D1 バッチ分割
│       ├── optimisticLock.ts      # 楽観ロック
│       └── projectCode.ts         # 案件コード自動採番
├── public/
│   └── static/
│       ├── app.js                 # フロントエンド
│       └── styles.css
├── migrations/
│   └── 0001_initial_schema.sql    # 12_MIGRATION_SQL_FINAL.md から
├── seeds/
│   ├── seed_categories_priority_a.json
│   ├── seed_items_priority_a.json
│   ├── seed_item_versions_priority_a.json
│   └── seed_rules_priority_a.json
├── scripts/
│   └── import_seed_to_d1.ts
├── ecosystem.config.cjs
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 6. 重要な実装パターン

### 6-1. final_* 算出

```typescript
function calculateFinal(item: ProjectCostItem): {
  final_quantity: number | null;
  final_unit_price: number | null;
  final_amount: number;
} {
  const fq = item.manual_quantity ?? item.auto_quantity;
  const fup = item.manual_unit_price ?? item.auto_unit_price;
  
  let fa: number;
  if (item.manual_amount != null) {
    fa = item.manual_amount;
  } else if (item.manual_quantity != null || item.manual_unit_price != null) {
    fa = (fq ?? 0) * (fup ?? 0);
  } else if (
    item.auto_fixed_amount != null &&
    ['fixed_amount', 'lineup_fixed'].includes(item.calculation_type ?? '')
  ) {
    fa = item.auto_fixed_amount;
  } else {
    fa = item.auto_amount ?? 0;
  }
  
  return { final_quantity: fq, final_unit_price: fup, final_amount: fa };
}
```

### 6-2. ルール評価の型変換

```typescript
function compareValue(
  dbValue: unknown,
  ruleValue: unknown,
  operator: string
): boolean {
  // boolean → integer
  if (typeof ruleValue === 'boolean') {
    return operator === '='
      ? dbValue === (ruleValue ? 1 : 0)
      : dbValue !== (ruleValue ? 1 : 0);
  }
  // 数値
  if (typeof ruleValue === 'number') {
    const numDb = Number(dbValue);
    switch (operator) {
      case '=': return numDb === ruleValue;
      case '>': return numDb > ruleValue;
      case '>=': return numDb >= ruleValue;
      case '<': return numDb < ruleValue;
      case '<=': return numDb <= ruleValue;
      default: return false;
    }
  }
  // 配列（in / between）
  if (Array.isArray(ruleValue)) {
    if (operator === 'in') return ruleValue.includes(dbValue);
    if (operator === 'between') {
      const num = Number(dbValue);
      return num >= ruleValue[0] && num < ruleValue[1];
    }
  }
  // 文字列
  return String(dbValue) === String(ruleValue);
}
```

### 6-3. D1 バッチ分割

```typescript
async function batchInsert(
  db: D1Database,
  statements: D1PreparedStatement[],
  batchSize: number = 100
): Promise<void> {
  for (let i = 0; i < statements.length; i += batchSize) {
    const batch = statements.slice(i, i + batchSize);
    await db.batch(batch);
  }
}
```

---

## 7. テスト戦略

### 7-1. ユニットテスト（計算エンジン）

各計算ハンドラーに対して、02_COST_CALCULATION_DEFINITIONS_v2.md の具体的金額でテスト。

```typescript
// 例: 基礎工事の面積帯テスト
test('foundation 60-90m2 range', () => {
  const result = calculatePerM2({
    building_area_m2: 72.5,
    base_unit_price: 25000,
  });
  expect(result).toBe(1812500); // 72.5 × 25,000
});
```

### 7-2. 統合テスト（テスト案件4パターン）

05_MASTER_DATA_PLAN_v3.md の検証5に基づく。

### 7-3. ルール発火テスト（12パターン）

05_MASTER_DATA_PLAN_v3.md の検証6に基づく。

---

## 8. Phase 2 拡張要件（実装スコープ外・設計のみ）

以下はPhase 1では実装しないが、v4テーブル設計で対応準備済み:

| 機能 | 関連テーブル | Phase 1での状態 |
|------|-------------|----------------|
| lineup_packages による複合パッケージ | `lineup_packages` | テーブル作成済み、データ未投入 |
| AI PDF読取 | `project_input_sources` | テーブル作成済み、API未実装 |
| 外部参照管理 | `external_references` | テーブル作成済み、API未実装 |
| 見積比較画面 | `project_sales_estimates` | テーブル作成済み、比較UI未実装 |
| ユーザー管理画面 | `app_users` | テーブル作成済み、admin画面未実装 |
| 過去バージョン参照UI | `cost_master_item_versions` | テーブル作成済み、参照UI未実装 |
| 地域ルール管理画面 | `area_rules` | テーブル作成済み、管理UI未実装 |

---

*最終更新: 2026-03-07*
*対象: AI駆動開発チーム（Cursor / Claude Code / Copilot 等）*
*前提ドキュメント: 01_DB_SCHEMA_DESIGN_v4.md, 11_ENUM_STATUS_SPEC.md, 12_MIGRATION_SQL_FINAL.md*
