# AI 駆動開発チーム向け 実装指示書 v3（正式改訂版）

> **目的**: AI コーディングアシスタント（Cursor / Claude Code / Copilot 等）が、本プロジェクトの設計ドキュメントを正確に理解し、整合性のある実装を行うためのガイド。
> **前提**: すべての設計判断は完了済み。本ドキュメントは「何をどの順序で実装するか」の指示に集中する。
> **改訂履歴**:
> - v1: 初版作成（ドラフト）
> - v2: 正式改訂。禁止事項（セクション3）を新設。絶対ルール10項目を明文化。必読ドキュメントを v3/v4 対応に更新。ファイル構成を v3 画面設計と整合。
> - **v3: 正式改訂。禁止事項を P-01〜P-15 に拡充（15項目）。「絶対ルール」を独立セクション化し R-01〜R-10 で番号管理。数値整合性セクション追加。Step 0 許可/禁止アクティビティ明確化。ドキュメント間参照を最新版に統一。**

---

## 1. プロジェクト概要（実装者向け要約）

**システム名**: 平松建築 概算原価管理システム
**技術スタック**: Cloudflare Pages + Workers + Hono + D1 + R2 + Queues
**認証**: Cloudflare Access (Zero Trust) + app_users テーブル + RBAC 4ロール
**DB**: Cloudflare D1 (SQLite), **25テーブル**, CHECK制約付き
**非同期処理**: Cloudflare Queues (SNAPSHOT_QUEUE) で shadow snapshot 生成
**対象ユーザー**: 社内5〜10名
**画面数**: **18画面**（03_SCREEN_DESIGN_v3.md）
**APIエンドポイント数**: **50+**（14_DEPENDENCY_MAP.md v2）
**ロール数**: **4**（admin / manager / estimator / viewer）
**工種数**: **37**（standard 35 + solar 1 + option 1）
**計算方式数**: **12**

**核心機能**: 住宅建築の37工種の原価を、12パターンの計算方式で自動/半自動計算し、粗利率を管理する。計算結果は shadow snapshot として非同期生成し、revision_no で一元管理する。

### 1-1. 数値整合性チェック表（全ドキュメント共通）

| 項目 | 正式値 | 根拠ドキュメント |
|------|--------|----------------|
| テーブル数 | **25** | 01_DB_SCHEMA_DESIGN_v4.md |
| 依存関係マップテーブル | **25**（Layer 0〜6） | 14_DEPENDENCY_MAP.md v2 |
| Phase 1 必須画面数 | **18** | 03_SCREEN_DESIGN_v3.md |
| ロール数 | **4** | 11_ENUM_STATUS_SPEC.md |
| 工種数 | **37** | 02_COST_CALCULATION_DEFINITIONS_v2.md |
| 計算方式数 | **12** | 02_COST_CALCULATION_DEFINITIONS_v2.md |
| diff_type 種別 | **7** | 11_ENUM_STATUS_SPEC.md |
| job_type 種別 | **4** | 11_ENUM_STATUS_SPEC.md |
| warning_type 種別 | **9** | 11_ENUM_STATUS_SPEC.md |
| system_settings 初期行 | **9** | 12_MIGRATION_SQL_FINAL.md |
| ブロッカー（実装前必須） | **B-01〜B-04, B-06 = 5件** | 06_PHASE1_IMPLEMENTATION_PLAN_v3.md |
| ブロッカー（並行解決可） | **B-05, B-07, B-08 = 3件** | 06_PHASE1_IMPLEMENTATION_PLAN_v3.md |
| ブロッカー合計 | **B-01〜B-08 = 8件**（B-05完了済みのため実質 **7件**） | 15_MANAGEMENT_ITEMS.md |
| API エンドポイント | **50+** | 03_SCREEN_DESIGN_v3.md + 14_DEPENDENCY_MAP.md v2 |

> **注意**: 実装中に上記の数値と矛盾する状態に気づいた場合、実装を中断してドキュメント担当に報告すること。

---

## 2. 必読ドキュメント一覧（優先度順）

実装前に必ず読むべきドキュメント:

| 優先度 | ドキュメント | 正式版 | 読む理由 |
|--------|------------|--------|---------|
| **必須** | `11_ENUM_STATUS_SPEC.md` | v1 | 全 enum 値、CHECK 制約、Zod スキーマ。実装の型定義の根拠 |
| **必須** | `01_DB_SCHEMA_DESIGN_v4.md` | **v4** | DB設計（25テーブル）。テーブル構造と関係性 |
| **必須** | `12_MIGRATION_SQL_FINAL.md` | v1 | マイグレーションSQL。そのまま適用可能 |
| **必須** | `02_COST_CALCULATION_DEFINITIONS_v2.md` | v2 | 37工種の計算ロジック。計算エンジンの根拠 |
| **必須** | `03_SCREEN_DESIGN_v3.md` | **v3** | **18画面詳細仕様・API設計・画面遷移。UIの根拠** |
| **必須** | `14_DEPENDENCY_MAP.md` | **v2** | **DAG構造の全体依存関係。API/画面/テーブル対照表** |
| **必須** | `13_AI_DEV_TEAM_INSTRUCTIONS.md` | **v3** | **本ドキュメント。禁止事項・絶対ルール** |
| **高** | `06_PHASE1_IMPLEMENTATION_PLAN_v3.md` | **v3** | **実装ステップ・工数・クリティカルパス** |
| **高** | `05_MASTER_DATA_PLAN_v3.md` | v3 | シードデータ構造とバリデーション仕様 |
| **高** | `15_MANAGEMENT_ITEMS.md` | v1 | 管理項目一覧・品質チェックポイント |
| **中** | `10_IMPLEMENTATION_READINESS_CHECKLIST.md` | **v2** | Go/No-Go 最終チェック |
| **低** | その他（00, 04, 07, 08, 09） | - | 背景情報・参考 |

---

## ★ 3. 禁止事項（違反厳禁 — 実装で絶対に行ってはならないこと）

> **運用ルール**: 禁止事項に抵触するコードを検出した場合、即座に修正すること。「暫定実装」「後で直す」は許容しない。

### 🚫 P-01: DB トリガー禁止

```
禁止: D1 (SQLite) で CREATE TRIGGER を使用すること
理由: Cloudflare Workers 環境ではトリガーの動作保証がない。
      ロジックの暗黙的な副作用により、デバッグ不能になる。
代替: アプリケーション層で明示的に処理する。
      master_change_logs, project_audit_logs は INSERT 文で明示的に記録。
検証: grep -r "CREATE TRIGGER" で0件であること
```

### 🚫 P-02: 同期スナップショット生成禁止

```
禁止: POST /api/projects/:id/calculate のリクエスト処理中に、
      同期的にスナップショット（project_cost_snapshots, project_cost_items）を生成すること。
理由: Workers の CPU 時間制限（30ms paid）を超過する。
      大量の INSERT がリクエストタイムアウトを引き起こす。
正解: 必ず Cloudflare Queues (SNAPSHOT_QUEUE) 経由で非同期処理。
      API は 202 Accepted + job_id を即座に返却し、
      Queue Consumer (snapshotJobProcessor) で shadow snapshot を生成。
検証: POST /api/projects/:id/calculate が 202 を返し、レスポンスに job_id を含むこと。
      同エンドポイントで project_cost_items への INSERT が行われていないこと。
```

### 🚫 P-03: shadow snapshot 方式の省略禁止

```
禁止: スナップショットを「上書き更新」で実装すること。
      既存の project_cost_items を UPDATE で書き換えること。
正解: 必ず新しい project_cost_snapshots レコードを INSERT し、
      旧 snapshot の status を 'superseded' に更新。
      projects.current_snapshot_id を新 snapshot.id に切替。
      失敗時は旧 snapshot が一切変更されない（安全ロールバック）。
検証: snapshot 生成時に UPDATE project_cost_items が存在しないこと（手修正除く）。
```

### 🚫 P-04: revision_no の複数管理禁止

```
禁止: スナップショットや明細に独自の version_no / revision 番号を持たせること。
正解: revision_no は projects.revision_no で一元管理。
      スナップショット生成ごとに +1 インクリメント。
      1案件1連番。他のテーブルで revision を持たない。
検証: project_cost_snapshots, project_cost_items に revision_no カラムがないこと。
      projects テーブルのみに revision_no が存在すること。
```

### 🚫 P-05: 明細更新と工種合計更新の分離禁止

```
禁止: project_cost_items の UPDATE と project_cost_summaries の UPDATE を
      別々のトランザクションで実行すること。
理由: 中間状態で明細と合計が不整合になる。
正解: 手修正 (PUT /costs/:itemId) では以下を 1TX で実行:
      1. project_cost_items UPDATE (manual_*, override_reason)
      2. final_* 再計算
      3. project_cost_summaries UPSERT (該当工種の合計再集計)
      4. project_audit_logs INSERT
検証: PUT /costs/:itemId のハンドラーで db.batch() が1回のみ呼ばれ、
      上記4操作が全て含まれていること。
```

### 🚫 P-06: replace_all の estimator/viewer への開放禁止

```
禁止: regenerate_replace_all (全明細白紙再計算) を estimator や viewer に許可すること。
理由: 確認済み明細・手修正値を含む全データが消失するため、
      データロスリスクが非常に高い。
正解: replace_all は manager 以上（admin, manager）のみ実行可能。
      UIに確認ダイアログを表示し、明示的な同意を得る。
検証: rbac.ts で replace_all ルートが ['admin', 'manager'] に制限されていること。
```

### 🚫 P-07: migration / seed / import のバラ更新禁止

```
禁止: migration だけ適用して seed を投入しない、
      seed を修正せず投入する、
      import スクリプトのバリデーションをスキップする。
正解: migration → seed JSON 修正(B-01/02/03) → import_seed_to_d1.ts
      (--validate-only 通過後に本投入) → 検証クエリ実行
      の一連をセットで実行。
      途中で止めた場合は、DB を削除してやり直す (db:reset)。
検証: npm run db:reset が上記一連をセットで実行すること。
```

### 🚫 P-08: 項目名・現行金額の簡略化禁止

```
禁止: seed JSON の item_name を省略・簡略化すること。
      cost_master_items.display_name を「基礎」など短縮すること。
      金額を round して丸めること。
理由: スプレッドシートとの突合検証で一致しなくなる。
正解: 項目名はスプレッドシートの表記をそのまま使用。
      金額は整数単位で正確に保持（円未満切捨ての場合は明示）。
検証: seed データの item_name がスプレッドシートの表記と完全一致していること。
```

### 🚫 P-09: UIを一般的CRUDに寄せる禁止

```
禁止: 原価一覧・工種詳細・サマリーの画面を
      「テーブルの CRUD 管理画面」のように設計すること。
理由: このシステムは「判断支援システム」であり、単なるデータ管理ではない。
      自動計算 → 確認 → 手修正 → レビュー のワークフローがあるため、
      状態遷移・警告表示・差分可視化が本質。
正解: 03_SCREEN_DESIGN_v3.md の詳細設計に従う。
      特に以下の UI 要素は省略しない:
      - review_status バッジ（4状態色分け）
      - override_reason 必須バリデーション
      - 計算ジョブのポーリング進捗表示
      - diff_type 7種の色分け表示
      - is_significant フラグ（赤ハイライト）
      - 警告の severity 別表示
検証: 03_SCREEN_DESIGN_v3.md の各画面「主要表示項目」が全て実装されていること。
```

### 🚫 P-10: AI の自動反映禁止

```
禁止: POST /api/ai/check-conditions の結果を、
      project_cost_items に自動で反映すること。
      AIの提案を人間の確認なしに適用すること。
理由: 設計原則「AIは提案のみ、最終判断は人間」(00_PROJECT_OVERVIEW セクション6-4)。
正解: AI結果は project_warnings に保存し、人間が WARNINGS 画面で確認・解決する。
      AIの出力には「参考情報です。最終判断は担当者が行います」と明記。
検証: POST /api/ai/check-conditions の結果が project_warnings にのみ INSERT され、
      project_cost_items が一切変更されないこと。
```

### 🚫 P-11: current_snapshot_id の直接 FK 制約禁止

```
禁止: projects.current_snapshot_id に対して SQL レベルの FOREIGN KEY 制約を張ること。
理由: projects と project_cost_snapshots が循環参照するため、
      CREATE TABLE 順序が成立しない。
正解: current_snapshot_id は nullable INTEGER カラムとし、
      アプリ層で整合性を保証する（14_DEPENDENCY_MAP.md セクション2-2）。
      snapshot 生成完了時に UPDATE projects SET current_snapshot_id = ? で更新。
検証: migration SQL に current_snapshot_id の REFERENCES 句がないこと。
```

### 🚫 P-12: CHECK 制約の省略禁止

```
禁止: 11_ENUM_STATUS_SPEC.md に定義された CHECK 制約を migration SQL から除外すること。
      「アプリ層でバリデーションするから不要」という判断は許容しない。
理由: D1 (SQLite) の CHECK 制約はデータ整合性の最後の砦。
      アプリのバグで不正値が INSERT されることを防ぐ。
正解: 12_MIGRATION_SQL_FINAL.md の CHECK 制約をそのまま使用。
      Zod バリデーション（アプリ層）と CHECK 制約（DB層）の二重防御。
検証: migration SQL の CHECK 制約数が 11_ENUM_STATUS_SPEC.md の定義数と一致すること。
```

### 🚫 P-13: enum ハードコーディング禁止

```
禁止: enum 値を文字列リテラルで直接使用すること。
      例: const status = 'draft'; if (role === 'admin') ...
理由: enum 値の変更時にコード全体の修正漏れが発生する。
正解: 11_ENUM_STATUS_SPEC.md に基づく Zod enum (src/schemas/enums.ts) を
      唯一の定義元として使用する。
検証: src/ 配下で grep -rn '"draft"\|"active"\|"admin"' の結果が
      enums.ts と test ファイル以外から検出されないこと。
```

### 🚫 P-14: 楽観ロック省略禁止

```
禁止: projects, project_cost_items, project_cost_summaries の UPDATE 時に
      version カラムの WHERE 条件チェックを省略すること。
理由: 2ユーザー同時編集時にデータ上書きが発生する。
正解: UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?
      影響行数 = 0 の場合は 409 Conflict を返す。
検証: 上記3テーブルの UPDATE 文に全て WHERE version = ? が含まれること。
```

### 🚫 P-15: D1 バッチ100件制限の無視禁止

```
禁止: db.batch() に 100 件を超える PreparedStatement を渡すこと。
理由: D1 のバッチ処理は最大100文の制限がある。超過するとエラーになる。
正解: src/utils/d1Batch.ts の batchExecute() を使い、
      100件ごとに分割して実行する。
検証: db.batch() への直接呼び出しが batchExecute() 経由のみであること。
```

---

## ★ 4. 絶対ルール（実装で必ず従うこと）

> **運用ルール**: 禁止事項は「やってはならないこと」、絶対ルールは「必ずやること」。両方に準拠して初めて正しい実装となる。

### R-01: shadow snapshot は必ず新規 INSERT

```
ルール: 計算実行のたびに新しい project_cost_snapshots を INSERT する。
        既存スナップショットは status = 'superseded' に更新。
        projects.current_snapshot_id を新 snapshot に切替。
関連禁止事項: P-03
```

### R-02: revision_no は projects テーブルで一元管理

```
ルール: スナップショット生成ごとに projects.revision_no を +1 する。
        他のテーブルに revision 番号を持たせない。
関連禁止事項: P-04
```

### R-03: 明細 UPDATE と summaries UPDATE は同一 TX

```
ルール: project_cost_items を手修正した場合、
        同一 db.batch() 内で以下を全て実行する:
        1. item UPDATE (manual_*, override_reason, version++)
        2. final_* 再計算反映
        3. summaries UPSERT (工種合計再集計)
        4. audit_logs INSERT
関連禁止事項: P-05
```

### R-04: replace_all は manager 以上のみ

```
ルール: regenerate_replace_all は admin, manager のみ実行可能。
        estimator, viewer には絶対に許可しない。
        UIで「全データが再生成されます。手修正は全て破棄されます。」
        の確認ダイアログを表示する。
関連禁止事項: P-06
```

### R-05: migration / seed / import はセット実行

```
ルール: migration → seed 修正 → import (--validate-only → 本投入) → 検証
        の一連を必ずセットで実行する。
        途中で止めた場合は db:reset からやり直す。
関連禁止事項: P-07
```

### R-06: 全 enum は Zod スキーマ経由で使用

```
ルール: 11_ENUM_STATUS_SPEC.md の定義を src/schemas/enums.ts に Zod enum として実装。
        アプリケーションコードでは必ず enums.ts からインポートする。
        文字列リテラルの直書きは禁止。
関連禁止事項: P-13
```

### R-07: 楽観ロックを全対象テーブルに適用

```
ルール: projects, project_cost_items, project_cost_summaries の
        UPDATE には必ず WHERE version = ? を付与。
        影響行数 0 → 409 Conflict 返却。
関連禁止事項: P-14
```

### R-08: override_reason は手修正時に必須

```
ルール: manual_quantity / manual_unit_price / manual_amount のいずれかを
        設定する場合、override_reason を必ず入力させる。
        override_reason が空の場合は 400 Bad Request を返す。
根拠: 03_SCREEN_DESIGN_v3.md COST_CATEGORY 画面仕様
```

### R-09: AI 結果は project_warnings にのみ保存

```
ルール: POST /api/ai/check-conditions の結果は
        project_warnings テーブルに INSERT する。
        project_cost_items を直接変更しない。
        UI には「参考情報です。最終判断は担当者が行います」と表示。
関連禁止事項: P-10
```

### R-10: 変更履歴は明示的に INSERT

```
ルール: マスタ変更 → master_change_logs に INSERT
        案件操作 → project_audit_logs に INSERT
        DB トリガーではなく、アプリケーション層で明示的に記録する。
関連禁止事項: P-01
```

---

## 5. 実装の鉄則（コーディング規約）

### 5-1. 型安全

```typescript
// ✅ 必ず 11_ENUM_STATUS_SPEC.md の Zod スキーマを使用
import { ProjectStatus, Lineup, CalculationType } from '../schemas/enums';

// ❌ 文字列リテラルを直書きしない（P-13 違反）
const status = 'draft'; // 型チェックが効かない
```

### 5-2. DB 操作

- **全 enum カラムに CHECK 制約がある** — 不正値を INSERT すると SQLite がエラーを返す（P-12）
- **Boolean は INTEGER (1/0)** — `true`/`false` は使えない
- **TEXT PK** — `cost_categories`, `cost_master_items`, `cost_master_item_versions`, `cost_rule_conditions` は TEXT 型 PK
- **バッチ100件制限** — D1 のバッチ処理は最大100文。分割必須（P-15、src/utils/d1Batch.ts）
- **楽観ロック** — `projects`, `project_cost_items`, `project_cost_summaries` に `version` カラム。更新時は必ず `WHERE version = ?` で確認（P-14）
- **FK制約はアプリ層** — D1 はデフォルト FK 無効。投入順序とアプリ層チェックで保証
- **current_snapshot_id** — FK制約を張らない。アプリ層で保証（P-11）

### 5-3. スナップショットジョブの排他制御

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

### 5-4. 認証フロー

```typescript
// ✅ Cloudflare Access JWT から email を取得し app_users で照合
let email = c.req.header('CF-Access-Authenticated-User-Email');

// 開発環境バイパス
if (!email && c.env.DEV_USER_EMAIL) {
  email = c.env.DEV_USER_EMAIL;
}

const user = await db.prepare(
  'SELECT * FROM app_users WHERE email = ? AND status = ?'
).bind(email, 'active').first();

if (!user) return c.json({ error: 'Unauthorized' }, 403);
c.set('user', { id: user.id, email: user.email, role: user.role, name: user.name });
```

### 5-5. shadow snapshot TX パターン（★最重要）

```typescript
// ✅ Queue Consumer 内の shadow snapshot 生成
// 14_DEPENDENCY_MAP.md セクション3-4-5 に準拠

// TX-2: shadow snapshot 生成（1トランザクション内）
const stmts = [];

// a. 新 snapshot INSERT
stmts.push(db.prepare(`INSERT INTO project_cost_snapshots (...) VALUES (...)`));

// b. cost_items INSERT（バッチ100件分割で追加）
for (const batch of splitIntoBatches(items, 100)) {
  for (const item of batch) {
    stmts.push(db.prepare(`INSERT INTO project_cost_items (...) VALUES (...)`));
  }
}

// c. summaries UPSERT
for (const summary of summaries) {
  stmts.push(db.prepare(`INSERT OR REPLACE INTO project_cost_summaries (...) VALUES (...)`));
}

// d. warnings INSERT
for (const warning of warnings) {
  stmts.push(db.prepare(`INSERT INTO project_warnings (...) VALUES (...)`));
}

// e. (regenerate時) diffs INSERT
if (diffs.length > 0) {
  for (const diff of diffs) {
    stmts.push(db.prepare(`INSERT INTO project_cost_regeneration_diffs (...) VALUES (...)`));
  }
}

// f. 旧 snapshot superseded
stmts.push(db.prepare(`UPDATE project_cost_snapshots SET status = 'superseded' WHERE id = ?`));

// g. projects.current_snapshot_id + revision_no 更新
stmts.push(db.prepare(`UPDATE projects SET current_snapshot_id = ?, revision_no = revision_no + 1 WHERE id = ?`));

// バッチ実行（100件制限対応で分割）— P-15 準拠
await batchExecute(db, stmts, 100);
```

---

## 6. Step 0: 許可/禁止アクティビティ（明確な境界）

### ✅ Step 0 で許可されるアクティビティ

| # | アクティビティ | 成果物 | 完了条件 |
|---|---------------|--------|---------|
| S0-1 | CI 基盤構築（npm scripts, TypeScript, Zod） | package.json, tsconfig.json, vite.config.ts | `npm run build` 成功 |
| S0-2 | D1 migration テスト環境の構築 | wrangler.jsonc, --local モード疎通 | `wrangler d1 migrations apply --local` 成功 |
| S0-3 | seed dry-run 環境の構築 | import_seed_to_d1.ts 骨格 | `--validate-only` モードで構文検証成功 |
| S0-4 | Cloudflare Access 疎通確認 | .dev.vars DEV_USER_EMAIL | CF-Access ヘッダー取得確認 |
| S0-5 | 最小 Queue/Consumer テスト | queue binding 設定 | メッセージ send → consume の往復確認 |
| S0-6 | partial index 検証 | テスト用 CREATE INDEX | D1 での CREATE INDEX ... WHERE 構文動作確認 |
| S0-7 | shadow snapshot 成立性検証 | 小規模テストデータ | 5明細程度で shadow snapshot TX の動作確認 |
| S0-8 | Zod enum 実装 | src/schemas/enums.ts | 11_ENUM_STATUS_SPEC.md の 22 enum 全網羅 |
| S0-9 | `/api/health` エンドポイント | src/routes/health.ts | 200 レスポンス返却 |

### ❌ Step 0 で禁止されるアクティビティ

| # | 禁止アクティビティ | 理由 | 正しいタイミング |
|---|-------------------|------|----------------|
| X0-1 | 正式 migration 投入（25テーブル本番） | B-01〜B-04 未解決 | Step 1 |
| X0-2 | 本格 seed 投入 | ブロッカー修正後 | Step 1 |
| X0-3 | 大量 API 実装 | 認証基盤未構築 | Step 2 以降 |
| X0-4 | フロント本格実装 | API・データ未整備 | Step 8 以降 |
| X0-5 | 計算エンジン本実装 | マスタデータ未投入 | Step 5 |
| X0-6 | RBAC ミドルウェア本実装 | app_users 未投入 | Step 2 |

---

## 7. 実装ステップ（06_PHASE1_IMPLEMENTATION_PLAN_v3.md 準拠）

### 概要

```
Phase 1-A: 基盤構築（4日）
  Step 0: 環境セットアップ + CI基盤 (2日)
  Step 1: DB + Migration + Seed (1日)
  Step 2: 認証ミドルウェア + ユーザー管理 (1日)

Phase 1-B: マスタ管理 + 案件管理（5日）
  Step 3: マスタ管理API + 画面 (3日)
  Step 4: 案件CRUD + ダッシュボード (2日)

Phase 1-C: 計算エンジン + スナップショット（12日）★最重要
  Step 5: 計算エンジンコア (6日)
  Step 6: スナップショットジョブ (3日)
  Step 7: 再生成 + diff生成 (3日)

Phase 1-D: フロントエンド + 仕上げ（10日）
  Step 8: 原価一覧・工種詳細画面 (4日)
  Step 9: サマリー・売価・diff解決・ユーザー管理UI (3日)
  Step 10: 警告・変更履歴・AIチェック・設定 (2日)
  Step 11: 検証・仕上げ (1日)

クリティカルパス: 23日 + バッファ3日 = 26日
```

---

## 8. ファイル構成ガイド（v3 対応）

```
webapp/
├── src/
│   ├── index.tsx                  # Hono エントリポイント
│   ├── schemas/
│   │   ├── enums.ts               # 11_ENUM_STATUS_SPEC.md の Zod 定義
│   │   ├── project.ts             # 案件スキーマ
│   │   ├── master.ts              # マスタスキーマ
│   │   ├── cost.ts                # 原価スキーマ
│   │   └── user.ts                # ユーザースキーマ
│   ├── middleware/
│   │   ├── auth.ts                # Cloudflare Access 認証
│   │   └── rbac.ts                # ロールベースアクセス制御
│   ├── routes/
│   │   ├── projects.ts            # 案件 API
│   │   ├── master.ts              # マスタ API
│   │   ├── costs.ts               # 原価 API
│   │   ├── snapshots.ts           # スナップショット API
│   │   ├── diffs.ts               # 差分 API
│   │   ├── warnings.ts            # 警告 API
│   │   ├── users.ts               # ユーザー管理 API
│   │   ├── settings.ts            # 設定 API
│   │   ├── ai.ts                  # AI連携 API
│   │   ├── logs.ts                # 変更履歴 API
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
│   │   ├── diffGenerator.ts       # diff 生成ロジック
│   │   └── snapshotJob.ts         # Queue Consumer
│   ├── services/
│   │   ├── projectService.ts
│   │   ├── masterService.ts
│   │   ├── costService.ts
│   │   ├── snapshotService.ts     # shadow snapshot 管理
│   │   ├── warningService.ts
│   │   ├── userService.ts         # ユーザー管理
│   │   └── openai/
│   │       └── conditionChecker.ts
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
│   ├── seed_rules_priority_a.json
│   └── admin_user.sql             # admin ユーザー投入用
├── scripts/
│   └── import_seed_to_d1.ts
├── ecosystem.config.cjs
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 9. 重要な実装パターン

### 9-1. final_* 算出（01_DB_v4 T-01 仕様）

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

### 9-2. ルール評価の型変換（11_ENUM セクション21）

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
      case '!=': return numDb !== ruleValue;
      case '>': return numDb > ruleValue;
      case '>=': return numDb >= ruleValue;
      case '<': return numDb < ruleValue;
      case '<=': return numDb <= ruleValue;
      default: return false;
    }
  }
  // 配列（in / not_in / between）
  if (Array.isArray(ruleValue)) {
    if (operator === 'in') return ruleValue.includes(dbValue);
    if (operator === 'not_in') return !ruleValue.includes(dbValue);
    if (operator === 'between') {
      const num = Number(dbValue);
      return num >= ruleValue[0] && num < ruleValue[1]; // 半開区間 [min, max)
    }
  }
  // 文字列
  return String(dbValue) === String(ruleValue);
}
```

### 9-3. D1 バッチ分割

```typescript
async function batchExecute(
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

### 9-4. 手修正 TX パターン（P-05 / R-03 遵守）

```typescript
// ✅ 明細更新と工種合計更新を1TXで実行
async function updateCostItem(
  db: D1Database,
  itemId: string,
  updates: { manual_quantity?: number; manual_unit_price?: number; manual_amount?: number; override_reason: string },
  version: number,
  userId: number
): Promise<void> {
  const stmts = [];
  
  // 1. item UPDATE (楽観ロック — P-14 / R-07)
  stmts.push(db.prepare(
    `UPDATE project_cost_items 
     SET manual_quantity = ?, manual_unit_price = ?, manual_amount = ?,
         override_reason = ?, version = version + 1, updated_at = datetime('now')
     WHERE id = ? AND version = ?`
  ).bind(updates.manual_quantity, updates.manual_unit_price, updates.manual_amount,
         updates.override_reason, itemId, version));
  
  // 2. final_* 再計算 → summaries UPSERT (categoryCode で集計)
  // 3. audit_log INSERT
  stmts.push(db.prepare(
    `INSERT INTO project_audit_logs (project_id, action, target_type, target_id, user_id, ...)
     VALUES (?, 'override', 'cost_item', ?, ?, ...)`
  ).bind(projectId, itemId, userId));
  
  await db.batch(stmts);
}
```

---

## 10. テスト戦略

### 10-1. ユニットテスト（計算エンジン）

各計算ハンドラーに対して、02_COST_CALCULATION_DEFINITIONS_v2.md の具体的金額でテスト。

### 10-2. 統合テスト（テスト案件4パターン）

| # | lineup | tsubo | insulation_grade | is_shizuoka | 検証対象工種 |
|---|--------|-------|-----------------|------------|------------|
| 1 | SHIN | 35 | 5 | 1 (県内) | 基礎・木工事・断熱 |
| 2 | RIN | 42 | 6 | 1 (県内) | RIN加算含む全工種 |
| 3 | MOKU_HIRAYA | 28 | 5 | 0 (県外) | MOKU平屋 |
| 4 | MOKU_OOYANE | 30 | 6 | 0 (県外) | MOKU大屋根 |

### 10-3. 権限テスト（4ロール × 主要操作）

11_ENUM_STATUS_SPEC.md セクション23、14_DEPENDENCY_MAP.md セクション6 の権限マトリクスに基づく。

### 10-4. 楽観ロックテスト

2タブ同時編集による409衝突を再現テスト。

---

## 11. Phase 2 拡張要件（実装スコープ外・設計のみ）

以下はPhase 1では実装しないが、v4テーブル設計で対応準備済み:

| 機能 | 関連テーブル | Phase 1での状態 |
|------|-------------|----------------|
| lineup_packages による複合パッケージ | `lineup_packages` | テーブル作成済み、データ未投入 |
| AI PDF読取 | `project_input_sources` | テーブル作成済み、API未実装 |
| 外部参照管理 | `external_references` | テーブル作成済み、API未実装 |
| 見積比較画面 | `project_sales_estimates` | テーブル作成済み、比較UI未実装 |
| ルール管理画面（編集機能） | `cost_rule_conditions` | Phase 1は閲覧のみ |
| 地域ルール管理画面 | `area_rules` | テーブル作成済み、管理UI未実装 |
| 顧客管理テーブル | `project_customers` (新規) | Phase 1は projects.customer_name で代替 |

---

## 12. 禁止事項チェックリスト（各 Step 完了時に必ず確認）

```
□ P-01: CREATE TRIGGER を使っていないか
□ P-02: 計算API内で同期的にスナップショットを生成していないか
□ P-03: 既存スナップショットを UPDATE で上書きしていないか
□ P-04: revision_no を projects テーブル以外で管理していないか
□ P-05: 明細更新と工種合計更新を同一 TX で実行しているか
□ P-06: replace_all が manager 以上に制限されているか
□ P-07: migration/seed/import をセットで実行しているか
□ P-08: 項目名・金額がスプレッドシートと完全一致しているか
□ P-09: UIが CRUD 管理画面ではなく判断支援UIになっているか
□ P-10: AI結果が自動反映されず、warnings 経由になっているか
□ P-11: current_snapshot_id にFK制約を張っていないか
□ P-12: CHECK制約が migration SQL に全て含まれているか
□ P-13: enum値を文字列リテラルで直書きしていないか
□ P-14: 楽観ロック（WHERE version = ?）が省略されていないか
□ P-15: db.batch() が100件以内で分割されているか
```

## 13. 絶対ルールチェックリスト（各 Step 完了時に必ず確認）

```
□ R-01: shadow snapshot が新規 INSERT で生成されているか
□ R-02: revision_no が projects のみで管理されているか
□ R-03: 明細更新と summaries 更新が同一 TX か
□ R-04: replace_all が manager 以上に制限されているか
□ R-05: migration/seed/import がセットで実行されているか
□ R-06: 全 enum が Zod enum 経由で使用されているか
□ R-07: 楽観ロックが全対象テーブルに適用されているか
□ R-08: override_reason が手修正時に必須になっているか
□ R-09: AI結果が project_warnings にのみ保存されているか
□ R-10: 変更履歴が明示的に INSERT されているか
```

---

*最終更新: 2026-03-07*
*対象: AI駆動開発チーム（Cursor / Claude Code / Copilot 等）*
*改訂番号: v3（正式改訂 — 禁止事項15項目、絶対ルール10項目、数値整合性、Step 0境界明確化）*
*前提ドキュメント: 01_DB_v4, 03_SCREEN_v3, 06_PLAN_v3, 11_ENUM, 12_MIGRATION, 14_DEP_MAP_v2, 15_MANAGEMENT_ITEMS*
