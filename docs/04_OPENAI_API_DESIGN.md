# OpenAI API 活用設計

## 基本方針

### 3原則
1. **AIは提案、最終判断は人間** - AIに原価を勝手に決めさせない
2. **AI出力は必ず構造化** - 自由文のままDBに入れない
3. **根拠を残す** - AIがどの資料から何を読み取ったかを記録する

### 使用API
- **OpenAI Responses API**（推奨。Assistants APIは非推奨、今後Responses APIに統合）
- 構造化出力（Structured Outputs）で決まったJSONスキーマを指定
- Workers から直接呼び出し

### APIキーの管理
- 本番：`wrangler secret put OPENAI_API_KEY`
- 開発：`.dev.vars` に `OPENAI_API_KEY=sk-...`
- フロントからは絶対に呼ばない（Workers経由のみ）

---

## AI活用の6機能

### 機能A：外注見積・資料の構造化読取（Phase 1後半〜Phase 2）

#### 目的
業者見積書PDF、商品見積、サッシ表、建具表などから項目を抽出し、明細マスタや案件明細への取込を支援する。

#### 対象資料
- 業者見積書PDF
- メーカー商品見積
- サッシ表・建具表
- 仕様書
- 行政資料（加入分担金等）

#### 処理フロー
```
[ユーザー] PDFアップロード
     ↓
[Workers] R2に保存
     ↓
[Workers] PDFからテキスト抽出（pdf-parse等）
     ↓
[Workers] OpenAI Responses API 呼出し
          - システムプロンプト：抽出ルール
          - ユーザーメッセージ：抽出テキスト + 工種指定
          - response_format: json_schema 指定
     ↓
[Workers] 構造化JSONを一時テーブルに保存
     ↓
[UI] 確認画面で表示
     ↓
[ユーザー] 確認・修正・承認
     ↓
[Workers] 正式テーブルに反映
```

#### 構造化出力スキーマ（例：見積書読取）

```json
{
  "type": "object",
  "properties": {
    "vendor_name": { "type": "string", "description": "発注先名" },
    "quote_date": { "type": "string", "description": "見積日 YYYY-MM-DD" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "item_name": { "type": "string", "description": "項目名" },
          "category_suggestion": { "type": "string", "description": "推定工種コード" },
          "quantity": { "type": "number", "description": "数量" },
          "unit": { "type": "string", "description": "単位" },
          "unit_price": { "type": "number", "description": "単価" },
          "amount": { "type": "number", "description": "金額" },
          "note": { "type": "string", "description": "備考" },
          "confidence": { "type": "number", "description": "読取信頼度 0-1" }
        },
        "required": ["item_name", "amount", "confidence"]
      }
    },
    "total_amount": { "type": "number", "description": "合計金額" }
  },
  "required": ["items"]
}
```

#### 推奨モデル
- `gpt-4o`：精度重視（見積書の初回読取）
- `gpt-4o-mini`：コスト重視（定型資料の読取）

#### 向いている工種
| 工種 | 想定資料 | 期待効果 |
|------|---------|---------|
| サッシ・鋼製建具 | メーカー見積PDF | 商品名・サイズ・単価の自動抽出 |
| 内装建具 | メーカー見積PDF | 建具種類・高さ・単価の自動抽出 |
| 家具製造 | 造作見積PDF | 寸法・仕様・単価の抽出 |
| 太陽光 | メーカー見積PDF | 容量・構成・金額の抽出 |
| 土工事 | 外注見積 | 工事内容・金額の抽出 |
| 水道工事 | 自治体料金表 | 加入分担金の抽出 |

---

### 機能B：条件漏れチェック（Phase 1）

#### 目的
案件条件と採用明細を照合し、漏れや矛盾を検出する。

#### 処理フロー
```
[ユーザー] 「AIチェック実行」ボタン
     ↓
[Workers] 案件条件 + 全採用明細 + ルール定義をまとめる
     ↓
[Workers] OpenAI Responses API 呼出し
          - システムプロンプト：チェックルール一覧
          - ユーザーメッセージ：案件データJSON
          - response_format: json_schema 指定
     ↓
[Workers] チェック結果をproject_warningsに保存
     ↓
[UI] 警告として表示
```

#### システムプロンプト（例）

```
あなたは住宅建築の原価見積チェッカーです。
以下の案件条件と採用明細を確認し、漏れや矛盾を検出してください。

チェック項目：
1. 2世帯住宅なのに浄化槽が10人槽になっていない
2. 防火地域なのにWB部材が標準地域単価のまま
3. 外壁で焼杉を採用しているのに木工事に加工費がない
4. 建築地がエリア外なのに美装工事のエリア外加算がない
5. 太陽光を採用しているのに蓄電池の検討がされていない
6. 水道工事で加入分担金が未入力
7. 延床面積145m2以上なのに浄化槽が5人槽のまま
8. RINラインナップなのに電気設備のRIN加算がない
9. 断熱等級6なのに断熱材が等級5構成のまま
10. 平屋なのにプレカットの平屋割増が入っていない
...

重要度を3段階で判定してください：
- error: 原価に直接影響する重大な漏れ
- warning: 確認が必要な事項
- info: 参考情報
```

#### 構造化出力スキーマ

```json
{
  "type": "object",
  "properties": {
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "severity": { "type": "string", "enum": ["error", "warning", "info"] },
          "category_code": { "type": "string", "description": "関連工種コード" },
          "message": { "type": "string", "description": "警告メッセージ" },
          "recommendation": { "type": "string", "description": "推奨アクション" },
          "rule_basis": { "type": "string", "description": "チェック根拠" }
        },
        "required": ["severity", "message", "recommendation"]
      }
    },
    "summary": { "type": "string", "description": "全体サマリー" }
  },
  "required": ["checks", "summary"]
}
```

#### 推奨モデル
- `gpt-4o-mini`：十分な精度でコスト効率が良い

#### コスト見積
- 1案件あたりの入力トークン：約2,000〜5,000
- 出力トークン：約500〜1,500
- gpt-4o-mini想定：1案件あたり約0.5〜2円
- 月間100案件でも月額500円以下

---

### 機能C：自由記述の標準化（Phase 2）

#### 目的
担当者の備考・コメントを構造化し、分析可能にする。

#### 入力例
```
"現地確認したら引込みが長いので追加必要そう。渥美設計に聞いてみる"
```

#### 出力例
```json
{
  "action_items": [
    {
      "type": "additional_cost",
      "category": "plumbing",
      "description": "給水引込み工事の追加可能性",
      "requires_confirmation": true
    },
    {
      "type": "vendor_inquiry",
      "vendor": "渥美設計",
      "description": "引込み距離・費用の確認",
      "requires_confirmation": true
    }
  ],
  "tags": ["水道工事", "引込み", "要確認"]
}
```

---

### 機能D：更新履歴の自然文生成（Phase 2）

#### 目的
単価変更・ルール変更時に、影響範囲と対応事項を自動要約する。

#### 入力
```json
{
  "change_type": "price_change",
  "target": "断熱材 屋根100mm",
  "before": 4182,
  "after": 4500,
  "reason": "メーカー値上げ"
}
```

#### 出力
```json
{
  "summary": "断熱材（屋根100mm）の単価が4,182円→4,500円に変更されました（メーカー値上げ）",
  "affected_projects": "進行中の全案件（断熱材使用分）に影響あり",
  "action_required": "進行中案件の原価再計算を推奨します",
  "estimated_impact_per_project": "屋根面積85m2の場合、約27,030円の原価増"
}
```

---

### 機能E：マスタ登録補助（Phase 2）

#### 目的
新しい業者見積や新商品が来たときに、マスタ登録候補を提案する。

#### 処理フロー
1. ユーザーがPDFをアップロード
2. 機能Aで構造化抽出
3. 既存マスタと照合
4. 新規項目・単価変更項目を提案
5. 管理者が承認してマスタ反映

---

### 機能F：設計図面からの数量候補抽出（Phase 3以降）

#### 目的
図面・仕様表から建具数量、タイル面積、家具寸法などを読み取る支援。

#### 注意
- 最初は半自動にとどめる
- 精度検証が必要
- Walk in Home / A's との連携の方が先に効果が出る可能性

---

## 実装優先順位

| 優先度 | 機能 | フェーズ | 効果 | 実装難易度 |
|--------|------|---------|------|-----------|
| ★★★ | B: 条件漏れチェック | Phase 1 | 直接ミス防止 | 低 |
| ★★★ | A: 見積PDF読取 | Phase 1後半 | 入力工数削減 | 中 |
| ★★ | C: コメント構造化 | Phase 2 | 分析品質向上 | 低 |
| ★★ | D: 更新履歴要約 | Phase 2 | 運用品質向上 | 低 |
| ★ | E: マスタ登録補助 | Phase 2 | マスタ運用効率化 | 中 |
| ★ | F: 図面数量抽出 | Phase 3 | 拾い漏れ防止 | 高 |

---

## Workers側の実装構成

```
src/
├── routes/
│   └── ai.ts              # AI関連APIルート
├── services/
│   └── openai/
│       ├── client.ts       # OpenAI APIクライアント
│       ├── schemas.ts      # 構造化出力スキーマ定義
│       ├── prompts.ts      # プロンプトテンプレート
│       ├── extract.ts      # PDF読取ロジック
│       └── check.ts        # 条件チェックロジック
└── types/
    └── ai.ts               # AI関連型定義
```

### Bindings

```typescript
type Bindings = {
  DB: D1Database;
  R2: R2Bucket;
  OPENAI_API_KEY: string;  // wrangler secret put
}
```

### API実装例（条件チェック）

```typescript
// src/routes/ai.ts
import { Hono } from 'hono';

const ai = new Hono<{ Bindings: Bindings }>();

ai.post('/api/ai/check-conditions', async (c) => {
  const { projectId } = await c.req.json();

  // 1. 案件データ取得
  const project = await c.env.DB.prepare(
    'SELECT * FROM projects WHERE id = ?'
  ).bind(projectId).first();

  const costItems = await c.env.DB.prepare(
    'SELECT * FROM project_cost_items WHERE project_id = ? AND is_selected = 1'
  ).bind(projectId).all();

  // 2. OpenAI API呼出し
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content: CONDITION_CHECK_PROMPT  // prompts.tsから
        },
        {
          role: 'user',
          content: JSON.stringify({
            project: project,
            cost_items: costItems.results
          })
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'condition_check_result',
          schema: CONDITION_CHECK_SCHEMA  // schemas.tsから
        }
      }
    })
  });

  const result = await response.json();
  const checks = JSON.parse(result.output[0].content[0].text);

  // 3. 警告をDBに保存
  for (const check of checks.checks) {
    await c.env.DB.prepare(`
      INSERT INTO project_warnings
      (project_id, category_id, warning_type, severity, message, recommendation)
      VALUES (?, ?, 'ai_check', ?, ?, ?)
    `).bind(
      projectId,
      null,  // category_codeからIDを解決する処理が必要
      check.severity,
      check.message,
      check.recommendation
    ).run();
  }

  return c.json({ success: true, checks: checks.checks });
});

export default ai;
```

---

## コスト管理

### 月間コスト見積

| 機能 | 回数/月 | トークン/回 | モデル | 月額想定 |
|------|---------|-----------|--------|---------|
| 条件チェック | 100回 | 5,000tok | gpt-4o-mini | ~500円 |
| PDF読取 | 30回 | 10,000tok | gpt-4o | ~3,000円 |
| コメント構造化 | 200回 | 1,000tok | gpt-4o-mini | ~200円 |
| 更新履歴要約 | 20回 | 2,000tok | gpt-4o-mini | ~100円 |
| **合計** | | | | **~4,000円/月** |

### コスト最適化
- 定型チェックはルールエンジンで処理し、AIは複雑な判定のみに使う
- gpt-4o-mini を優先使用
- レスポンスキャッシュの活用（同じ条件なら再利用）
- バッチ処理でAPIコール回数を抑える

---

## セキュリティ考慮

1. **APIキーはWorkers secretで管理** - フロントに露出しない
2. **入力サニタイズ** - プロンプトインジェクション防止
3. **出力検証** - JSON Schemaバリデーション
4. **レート制限** - 1ユーザーあたりのAPI呼出し回数制限
5. **監査ログ** - AI呼出し履歴を記録

---

*最終更新: 2026-03-07*
