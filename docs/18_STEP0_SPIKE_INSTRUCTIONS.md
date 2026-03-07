# Step 0 スパイク指示書 v1

> **目的**: Step 1（正式実装）に進む前に、技術的リスクを検証し、設計上の前提条件が D1 / Cloudflare Workers 環境で成立するかを確認する。
> **範囲**: 技術検証のみ。正式な migration / seed 投入 / API 実装は行わない。
> **期間**: 2日（13_AI_DEV_TEAM_INSTRUCTIONS.md v3 セクション6 Step 0 準拠）
> **成果物**: 4レポート（技術検証レポート、性能レポート、実装可否判定、変更要求一覧）

---

## 1. 検証対象一覧

| # | 検証項目 | 対応する設計前提 | 失敗時のインパクト |
|---|---------|---------------|-----------------|
| SP-01 | D1 partial index の成立性 | 14_DEPENDENCY_MAP_v2 INDEX 定義 | INDEX 設計の見直し |
| SP-02 | shadow snapshot TX の成立性 | P-03, R-01, セクション5-5 | snapshot 方式の根本見直し |
| SP-03 | Queue Job / Consumer の疎通 | P-02, SNAPSHOT_QUEUE | 非同期処理方式の見直し |
| SP-04 | current_snapshot_id 切替の原子性 | P-11, 14_DEP_MAP セクション2-2 | 循環参照解決方式の見直し |
| SP-05 | seed import dry-run | P-07, R-05 | import スクリプトの設計見直し |
| SP-06 | D1 transaction サイズ確認 | P-15, D1 バッチ100件制限 | バッチ分割戦略の見直し |
| SP-07 | Cloudflare Access 疎通 | セクション5-4 認証フロー | 認証方式の見直し |

---

## 2. 各検証の詳細仕様

### SP-01: D1 partial index の成立性確認

**目的**: `CREATE INDEX ... WHERE` 構文が D1 (SQLite) で動作するか

**手順**:
```sql
-- テスト用テーブル作成
CREATE TABLE IF NOT EXISTS _spike_test (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  project_id TEXT
);

-- partial index 作成テスト
CREATE INDEX IF NOT EXISTS idx_spike_active 
  ON _spike_test(project_id) WHERE status = 'active';

-- データ投入
INSERT INTO _spike_test (id, status, project_id) VALUES (1, 'active', 'P001');
INSERT INTO _spike_test (id, status, project_id) VALUES (2, 'archived', 'P001');
INSERT INTO _spike_test (id, status, project_id) VALUES (3, 'active', 'P002');

-- partial index が効いているか確認
EXPLAIN QUERY PLAN SELECT * FROM _spike_test WHERE status = 'active' AND project_id = 'P001';
```

**成功条件**: 
- CREATE INDEX ... WHERE がエラーなく実行される
- EXPLAIN QUERY PLAN で index が使用される

**失敗条件**:
- 構文エラーが発生する → 通常 INDEX に変更

**クリーンアップ**: `DROP TABLE IF EXISTS _spike_test;`

---

### SP-02: shadow snapshot TX の成立性確認

**目的**: 5明細程度の shadow snapshot 生成が 1 TX で完了するか

**手順**:
```typescript
// テスト用の最小限テーブルを作成（_spike_ プレフィックス）
// 5明細の INSERT + 1 snapshot INSERT + 1 summaries UPSERT + 
// 1 旧snapshot UPDATE + 1 projects UPDATE = 約10文

const stmts = [];
stmts.push(db.prepare(`INSERT INTO _spike_snapshots (...) VALUES (...)`));
for (const item of testItems) {  // 5件
  stmts.push(db.prepare(`INSERT INTO _spike_items (...) VALUES (...)`));
}
stmts.push(db.prepare(`INSERT OR REPLACE INTO _spike_summaries (...) VALUES (...)`));
stmts.push(db.prepare(`UPDATE _spike_snapshots SET status = 'superseded' WHERE id = ?`));
stmts.push(db.prepare(`UPDATE _spike_projects SET current_snapshot_id = ? WHERE id = ?`));

await db.batch(stmts);  // 全10文を1バッチで
```

**成功条件**:
- db.batch() が正常完了する
- 途中でエラーが発生した場合、全文がロールバックされる
- 実行時間 < 500ms

**失敗条件**:
- db.batch() がタイムアウトする → バッチ分割戦略の見直し
- 部分的にコミットされる → TX の原子性が保証されない

**測定項目**: 実行時間（ms）、成功率、ロールバック確認

---

### SP-03: Queue Job / Consumer の疎通確認

**目的**: Cloudflare Queues でメッセージの send → consume 往復を確認

**手順**:
```typescript
// Producer: メッセージ送信
await env.SNAPSHOT_QUEUE.send({
  type: 'spike_test',
  timestamp: Date.now(),
  payload: { test: true }
});

// Consumer: メッセージ受信（queue handler）
export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      console.log('Received:', message.body);
      // D1 にログ記録
      await env.DB.prepare(
        'INSERT INTO _spike_queue_log (message, received_at) VALUES (?, datetime("now"))'
      ).bind(JSON.stringify(message.body)).run();
      message.ack();
    }
  }
};
```

**成功条件**:
- メッセージが send 後 10 秒以内に consume される
- D1 にログが記録される
- message.ack() が正常完了する

**失敗条件**:
- Queue binding 設定エラー → wrangler.jsonc の修正
- Consumer が呼ばれない → Queue 設定の見直し

**測定項目**: 送信→受信の遅延時間（ms）、ack 成功率

---

### SP-04: current_snapshot_id 切替の原子性確認

**目的**: projects.current_snapshot_id の更新が他のテーブル操作と同一 TX で実行されるか

**手順**:
```typescript
// 1. テスト用 project 作成（current_snapshot_id = NULL）
// 2. テスト用 snapshot 作成
// 3. 同一 db.batch() 内で:
//    a. snapshot INSERT
//    b. projects UPDATE (current_snapshot_id = new_snapshot_id)
// 4. 成功時: projects.current_snapshot_id が新 snapshot.id と一致
// 5. 失敗シミュレーション: 意図的にエラーを発生させ、
//    projects.current_snapshot_id が NULL のままであることを確認
```

**成功条件**:
- 正常系: current_snapshot_id が正しく更新される
- 異常系: batch 内でエラー発生時、current_snapshot_id が変更されない

**失敗条件**:
- 部分コミットが発生する → アプリ層での補償トランザクション検討

---

### SP-05: seed import dry-run

**目的**: import_seed_to_d1.ts の骨格で --validate-only モードが動作するか

**手順**:
```typescript
// 1. seed_categories_priority_a.json を読み込み
// 2. Zod スキーマでバリデーション
// 3. D1 の CHECK 制約と照合（INSERT はしない）
// 4. バリデーションエラーを収集して出力

// --validate-only モード:
// - JSON ファイルの読み込みとパース
// - Zod スキーマによる型チェック
// - FK 参照の存在チェック（コード上で照合）
// - 重複 ID チェック
// - 結果を stdout に出力
```

**成功条件**:
- 4つの seed JSON ファイルが正常にパースされる
- Zod バリデーションが通る（B-01〜B-03 修正後）
- FK 参照チェックがパスする
- エラーレポートが構造化 JSON で出力される

**失敗条件**:
- JSON パースエラー → seed ファイルの修正
- Zod バリデーションエラー → スキーマまたは seed の修正

---

### SP-06: D1 transaction サイズ確認

**目的**: Priority A 工種（10工種、約49明細）の snapshot 生成に必要な INSERT 文数が 100 件以内に収まるか、または分割で正常動作するか

**手順**:
```
Priority A 工種の想定 INSERT 文数:
- project_cost_snapshots: 1件
- project_cost_items: 約49件（Priority A 明細数）
- project_cost_summaries: 10件（10工種）
- project_warnings: 約5件（推定）
- project_audit_logs: 1件
- 旧 snapshot UPDATE: 1件
- projects UPDATE: 1件
合計: 約68件 → 100件以内

Full 37工種の想定:
- project_cost_items: 約100〜150件（全明細数）
- project_cost_summaries: 37件
合計: 約200件 → 100件超え → batchExecute 分割必須
```

**テスト**:
```typescript
// 1. 50件のテスト INSERT を1バッチで実行 → 成功確認
// 2. 100件のテスト INSERT を1バッチで実行 → 成功確認
// 3. 150件のテスト INSERT を1バッチで実行 → エラー確認
// 4. 150件を batchExecute(db, stmts, 100) で分割実行 → 成功確認
// 5. 分割バッチ間の原子性を確認（2バッチ目でエラー発生時の挙動）
```

**成功条件**:
- 100件以内のバッチが正常完了する
- batchExecute 分割が正常動作する

**失敗条件**:
- 100件でもエラーが出る → D1 の制限がさらに厳しい
- 分割バッチ間で部分コミットが発生する → 補償ロジック必要

**測定項目**: 50件/100件/150件各バッチの実行時間、分割時の合計実行時間

---

### SP-07: Cloudflare Access 疎通確認

**目的**: CF-Access-Authenticated-User-Email ヘッダーの取得を確認

**手順**:
```typescript
// 開発環境: DEV_USER_EMAIL バイパス確認
// .dev.vars に DEV_USER_EMAIL=admin@hiramatsu.co.jp を設定

app.get('/api/spike/auth', (c) => {
  const email = c.req.header('CF-Access-Authenticated-User-Email') 
                || c.env.DEV_USER_EMAIL;
  return c.json({ email, authenticated: !!email });
});
```

**成功条件**:
- 開発環境で DEV_USER_EMAIL が取得できる
- ヘッダーが正しくパースされる

**失敗条件**:
- ヘッダー名が異なる → Cloudflare ドキュメント再確認

---

## 3. 必須成果物（4レポート）

### 成果物 1: 技術検証レポート

| 検証項目 | 結果 | 備考 |
|---------|------|------|
| SP-01 partial index | ✅/❌ | |
| SP-02 shadow snapshot TX | ✅/❌ | |
| SP-03 Queue/Consumer | ✅/❌ | |
| SP-04 current_snapshot 切替 | ✅/❌ | |
| SP-05 seed dry-run | ✅/❌ | |
| SP-06 D1 batch サイズ | ✅/❌ | |
| SP-07 CF Access 疎通 | ✅/❌ | |

### 成果物 2: 性能レポート

| 測定項目 | 値 | 許容範囲 | 判定 |
|---------|-----|---------|------|
| Priority A 工種 snapshot 生成時間 | ms | < 500ms | ✅/❌ |
| D1 書き込み件数（Priority A） | 件 | < 100件 | ✅/❌ |
| D1 バッチ分割後の合計実行時間 | ms | < 2000ms | ✅/❌ |
| Queue 送信→受信遅延 | ms | < 10000ms | ✅/❌ |
| Transaction 成功率 | % | 100% | ✅/❌ |
| タイムアウト発生 | 有/無 | 無 | ✅/❌ |

### 成果物 3: 実装可否判定

| 判定 | 条件 | アクション |
|------|------|----------|
| **GO: Step 1 へ進む** | SP-01〜07 全て ✅ | B-01〜B-04 修正後、Step 1 開始 |
| **CONDITIONAL GO: 修正後に進む** | 1〜2 項目が ❌ だが回避策あり | 変更要求を起票し、修正後に Step 1 |
| **NO-GO: 設計見直し** | 3項目以上 ❌ または致命的な ❌ あり | 設計ドキュメントの改訂が必要 |

### 成果物 4: 変更要求一覧

| # | 対象ドキュメント | 変更内容 | 理由 | 緊急度 |
|---|---------------|---------|------|--------|
| CR-01 | (検証結果に基づき記入) | | | |
| CR-02 | | | | |

---

## 4. Step 0 スパイクの禁止事項（再掲）

13_AI_DEV_TEAM_INSTRUCTIONS.md v3 セクション6 より:

| # | 禁止アクティビティ | 理由 | 正しいタイミング |
|---|-------------------|------|----------------|
| X0-1 | 正式 migration 投入（25テーブル本番） | B-01〜B-04 未解決 | Step 1 |
| X0-2 | 本格 seed 投入 | ブロッカー修正後 | Step 1 |
| X0-3 | 大量 API 実装 | 認証基盤未構築 | Step 2 以降 |
| X0-4 | フロント本格実装 | API・データ未整備 | Step 8 以降 |
| X0-5 | 計算エンジン本実装 | マスタデータ未投入 | Step 5 |
| X0-6 | RBAC ミドルウェア本実装 | app_users 未投入 | Step 2 |

> **重要**: スパイク用のテーブルは全て `_spike_` プレフィックスを使い、検証完了後に DROP する。正式テーブルには一切触れない。

---

## 5. Step 1 進行基準

Step 0 スパイク完了後、以下が **全て** 満たされた場合のみ Step 1 に進む。

| # | 基準 | 確認方法 |
|---|------|---------|
| G-01 | SP-01〜07 が全て GO または CONDITIONAL GO | 技術検証レポート |
| G-02 | CONDITIONAL GO の変更要求が全て起票済み | 変更要求一覧 |
| G-03 | B-01〜B-04 の修正が完了している | 10_IMPLEMENTATION_READINESS_CHECKLIST_v2 |
| G-04 | 12_MIGRATION_SQL_FINAL.md の SQL が migrations/ に配置済み | ファイル存在確認 |
| G-05 | `npm run build` が成功する | CI 成功 |
| G-06 | Zod enum (src/schemas/enums.ts) が 11_ENUM_STATUS_SPEC.md と整合 | コードレビュー |
| G-07 | wrangler.jsonc の D1 binding が設定済み | `wrangler d1 list` で確認 |

---

## 6. スパイク実行順序

```
Day 1（午前）:
  1. Hono プロジェクト初期化（npm create hono）
  2. wrangler.jsonc 設定（D1 binding, Queue binding）
  3. SP-07: CF Access 疎通確認
  4. SP-01: partial index 検証
  5. SP-06: D1 batch サイズ確認

Day 1（午後）:
  6. SP-02: shadow snapshot TX 検証
  7. SP-04: current_snapshot_id 切替検証
  8. Zod enum 実装（S0-8: src/schemas/enums.ts）

Day 2（午前）:
  9. SP-03: Queue/Consumer 疎通確認
  10. SP-05: seed import dry-run

Day 2（午後）:
  11. 性能測定（SP-02, SP-06 の詳細測定）
  12. 4レポート作成
  13. _spike_ テーブル・コードのクリーンアップ
  14. Git commit: "Step 0 spike: 技術検証完了"
```

---

## 7. 数値整合性チェック（再確認）

| 項目 | 正式値 | 本スパイクでの検証対象 |
|------|--------|---------------------|
| テーブル数 | 25 | SP-02 でテスト用テーブル構造のみ |
| 工種数 | 37 | SP-06 で Full 37工種のバッチサイズ推定 |
| 計算方式数 | 12 | スパイクでは検証しない（Step 5） |
| Priority A 明細数 | 49 | SP-06 で INSERT 文数の見積 |
| D1 バッチ上限 | 100 | SP-06 で実測 |
| system_settings 初期行 | 9 | SP-05 の dry-run で確認 |

---

*最終更新: 2026-03-07*
*改訂番号: v1（新規作成）*
*位置づけ: Step 1 への進行判断を行うための技術スパイク指示書*
*前提ドキュメント: 13_AI_DEV_v3 (セクション6), 06_PLAN_v3, 10_CHECKLIST_v2, 12_MIGRATION_SQL, 14_DEP_MAP_v2*
