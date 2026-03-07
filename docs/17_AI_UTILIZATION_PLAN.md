# AI 活用計画 v2（OpenAI 統合設計 — 正式改訂版）

> **目的**: OpenAI API を「読む・気づく・整理する」の3役割に限定し、見積もりミス防止の本来目的に直結する形で Phase 1 / Phase 2 に落とし込む。
> **大原則**: AI は提案のみ。最終判断は人間。自動反映禁止（13_AI_DEV_TEAM_INSTRUCTIONS.md P-10 準拠）。
> **位置づけ**: 16_UX_RISK_PREVENTION_DESIGN.md と対をなすドキュメント。UX 要件の AI 実装方針。
> **改訂履歴**:
> - v1: 初版作成
> - **v2: AI 警告の severity/confidence/推奨アクション体系を追加。KPI 責任者を設定。low confidence 表示ポリシーを明確化。PDF 読取の確認画面フローを強化。**

---

## 1. AI の3つの役割（設計原則）

| 役割 | 説明 | やること | やらないこと |
|------|------|---------|------------|
| **読む** | 見積資料・図面・業者見積を構造化して読み取る | 項目抽出、数量抽出、単価抽出、金額抽出 | 原価を勝手に決める |
| **気づく** | 条件漏れ・矛盾・異常値を検出して警告する | 指摘、比較、警告生成 | 自動で採用ON/OFF |
| **整理する** | 手修正理由・差異要因を分類・要約する | 分類、要約、ラベル付け | 勝手に単価更新 |

---

## 2. Phase 1 で入れる AI 機能（優先度 A〜C）

### AI-A: 条件漏れチェック（★最重要）

> **効果**: 見積もりミスの E-02（条件の選び忘れ）、E-03（現場条件の見落とし）を直接防止。

**API**: `POST /api/ai/check-conditions`（既存設計、03_SCREEN_DESIGN_v3.md 定義済み）

**入力（プロンプトに含めるデータ）**:

```typescript
interface AIConditionCheckInput {
  // 案件条件
  project: {
    lineup: string;
    tsubo_number: number;
    insulation_grade: number;
    is_shizuoka_prefecture: boolean;
    fire_zone_type: string;
    roof_shape: string;
    has_solar: boolean;
    has_special_foundation: boolean;
    // ... 全条件フィールド
  };
  // 採用工種一覧（計算済み）
  cost_items: {
    category_code: string;
    category_name: string;
    item_count: number;
    total_amount: number;
    has_manual_override: boolean;
  }[];
  // 警告すべきパターン（プロンプトに埋め込む知識）
  known_patterns: string[];
}
```

**AI に指示する検出パターン**:

| # | パターン | 条件例 | 期待する警告 |
|---|---------|--------|------------|
| C-01 | 工種の欠落 | 2世帯なのに浄化槽が5人槽 | 「浄化槽の人数が少ない可能性があります」 |
| C-02 | 条件不整合 | 外壁が焼杉なのに木工事加工費なし | 「焼杉外壁の場合、木工事加工費が必要です」 |
| C-03 | 地域条件漏れ | エリア外なのに美装加算なし | 「県外の場合、美装加算が必要な場合があります」 |
| C-04 | 行政条件漏れ | 自治体ありなのに加入分担金未入力 | 「自治体加入分担金が未入力です」 |
| C-05 | 異常金額 | 同規模案件より水道工事が異常に低い | 「水道工事が過去の類似案件平均より30%低いです」 |

**出力先**: project_warnings テーブル（warning_type = 'ai_condition_mismatch' など）

**UI表示**: 
- COST_OVERVIEW の「AIチェック」ボタン → 結果は見積リスクセンター（UX-01）に表示
- 各警告は人間が確認 → 解決/無視を選択

### AI 警告の severity / confidence / 推奨アクション体系

> AI が生成する警告には必ず以下の3属性を付与する。UI 表示はこの体系に従う。

#### severity（重大度）— AI が判定

| severity | 日本語 | UI 表示 | 表示条件 | ユーザーへの意味 |
|----------|--------|---------|---------|----------------|
| `high` | 高・今すぐ確認 | 🔴 赤バッジ + 見積リスクセンター最上位 | 原価に直結する未設定/矛盾 | **放置すると見積ミスになる可能性が高い** |
| `medium` | 中・可能性あり | 🟡 黄バッジ | 条件不整合の可能性 | **確認が望ましい。無視しても致命的ではない場合あり** |
| `low` | 低・参考情報 | ℹ️ 灰バッジ | 一般的な注意喚起 | **知っておくとよい情報。対応不要の場合が多い** |

#### confidence（確信度）— AI が判定

| confidence 範囲 | 表示ラベル | UI 表示ポリシー |
|----------------|-----------|----------------|
| **≥ 0.8** | 高確信 | severity に応じたバッジをそのまま表示 |
| **0.5 ≤ c < 0.8** | 中確信 | バッジに「（AI 推定）」を付記。severity を1段階下げて表示 |
| **< 0.5** | 低確信 | **デフォルト非表示**。「低確信の警告も表示する」チェックボックスで展開可能（AI-P-02 準拠） |

> **重要**: confidence < 0.5 の警告をデフォルト表示すると、ノイズが増え「AI が使えない」印象を与える。必ず折りたたむ。

#### suggested_action（推奨アクション）— AI が提案

| アクションコード | 日本語 | UI ボタン | 遷移先 |
|-----------------|--------|----------|--------|
| `check_input` | 入力内容を確認 | 「該当項目を確認する」 | PROJECT_DETAIL の該当ステップ |
| `check_item` | 工種明細を確認 | 「工種詳細を確認する」 | COST_CATEGORY の該当工種 |
| `add_item` | 明細の追加を検討 | 「工種詳細へ移動」 | COST_CATEGORY |
| `update_price` | 単価の確認 | 「単価を確認する」 | COST_CATEGORY のインライン編集 |
| `no_action` | 参考情報（対応不要） | 表示のみ（ボタンなし） | — |

#### AI 警告出力の構造化 JSON

```typescript
interface AIWarningOutput {
  warnings: {
    pattern_code: string;          // C-01〜C-05
    message: string;               // 日本語メッセージ
    severity: 'high' | 'medium' | 'low';
    confidence: number;            // 0.0〜1.0
    suggested_action: 'check_input' | 'check_item' | 'add_item' | 'update_price' | 'no_action';
    related_category_code?: string; // 関連工種コード
    detail?: string;               // 補足情報
  }[];
}
```

#### project_warnings への保存マッピング

```
AI output → project_warnings カラム:
  message → message
  severity → severity
  confidence → metadata JSON 内 { confidence: 0.85 }
  suggested_action → metadata JSON 内 { suggested_action: 'check_item' }
  related_category_code → category_code
  source = 'ai'
  warning_type = 'ai_condition_mismatch' | 'ai_missing_input' | ...
```

**プロンプト設計方針**:
- system prompt に平松建築の建築知識をハードコード（工種間の依存関係、地域条件の特殊性）
- user prompt に案件データをJSON形式で渡す
- レスポンスは構造化JSON（warnings 配列）で返させる
- temperature = 0（再現性重視）

**Phase 1 実装範囲**:
- 基本的な条件漏れチェック（C-01〜C-04）
- 結果は project_warnings に INSERT
- UI は既存の WARNINGS 画面 + 見積リスクセンターで表示

---

### AI-B: 業者見積・PDF の構造化読取

> **効果**: 転記ミス減少、手入力削減、見積比較の効率化。

**API**: `POST /api/ai/parse-document`（Phase 1 新規）

**対象ドキュメント**:

| # | 種類 | フォーマット | 抽出対象 |
|---|------|-----------|---------|
| D-01 | 業者見積PDF | PDF | 項目名、数量、単価、金額、発注先 |
| D-02 | サッシ見積 | PDF/Excel画像 | 品番、サイズ、数量、単価 |
| D-03 | 建具表 | PDF | 建具種類、サイズ、数量 |
| D-04 | 家具見積 | PDF | 品名、数量、金額 |
| D-05 | 行政資料 | PDF | 申請費目、金額 |

**処理フロー**:

```
1. ユーザーが PDF/画像をアップロード（R2 に保存）
2. POST /api/ai/parse-document に R2 キーを渡す
3. OpenAI Vision API (GPT-4o) でドキュメント解析
4. 構造化データ（JSON）を返却
5. ユーザーが確認・修正画面で内容を確認
6. 「反映」ボタンで project_cost_items の手修正値として適用
```

**出力データ構造**:

```typescript
interface ParsedDocumentResult {
  source_type: string;  // 'vendor_quote' | 'sash_quote' | ...
  vendor_name?: string;
  items: {
    description: string;    // 項目名
    quantity?: number;
    unit_price?: number;
    amount: number;
    suggested_category_code?: string;  // AI が推測する工種コード
    confidence: number;     // 0.0〜1.0
  }[];
  total_amount: number;
  raw_text: string;         // OCR テキスト（検証用）
}
```

**重要**: AI が抽出した内容は **確認画面** を必ず経由する。自動反映禁止。

**確認画面フローの強化仕様（v2 追加）**:

```
1. ユーザーが PDF をアップロード
2. AI が構造化データを生成（confidence 付き）
3. 確認画面表示:
   ┌─────────────────────────────────────────────────────────┐
   │ 📄 業者見積読取結果  ○○建材  confidence 全体: 0.82      │
   ├─────────────────────────────────────────────────────────┤
   │ ┌────────┬──────┬──────┬──────┬────────┬──────┐         │
   │ │項目名   │数量  │単価  │金額  │推定工種 │確信度│         │
   │ ├────────┼──────┼──────┼──────┼────────┼──────┤         │
   │ │断熱材A  │120m2 │2,800 │336K │insulation│✅0.92│        │
   │ │特殊部材B│  5個 │12,000│ 60K │(不明)   │⚠0.35│         │
   │ │運搬費   │  1式 │15,000│ 15K │foundation│✅0.78│        │
   │ └────────┴──────┴──────┴──────┴────────┴──────┘         │
   │                                                         │
   │ ⚠ confidence < 0.5 の項目は赤ハイライト                  │
   │   → ユーザーが手動で工種を選択・修正してから反映           │
   │                                                         │
   │ [全て破棄] [選択項目のみ反映] [全て反映]                   │
   │ ※「全て反映」でも project_cost_items に即書込みではなく     │
   │   手修正値としてプレフィルされる（保存は別途）             │
   └─────────────────────────────────────────────────────────┘
```

**Phase 1 実装範囲**:
- 業者見積 PDF の基本読取（D-01）
- R2 へのアップロード機能
- 確認・修正画面（上記仕様に準拠）
- project_input_sources テーブルへの記録

**Phase 2 拡張**:
- サッシ・建具・家具の専用パーサー
- 複数見積の比較機能
- 自動工種マッピングの精度向上

---

### AI-C: 手修正理由の分類

> **効果**: E-06（手修正理由が曖昧）を解消。後の分析・改善に使える構造化データを生成。

**API**: `POST /api/ai/classify-reason`（Phase 1 新規、ただし軽量）

**入力**:

```typescript
interface ClassifyReasonInput {
  override_reason: string;          // ユーザー入力のフリーテキスト
  category_code: string;            // 工種コード
  item_name: string;                // 明細名
  change_type: 'quantity' | 'unit_price' | 'amount';  // 何を変更したか
}
```

**出力**:

```typescript
interface ClassifyReasonResult {
  suggested_category: string;  // 理由コード候補
  confidence: number;          // 0.0〜1.0
  summary: string;             // 1行要約
}
```

**理由コード**（16_UX_RISK_PREVENTION_DESIGN.md UX-04 定義）:
- `site_condition` / `customer_request` / `regulatory` / `spec_change` / `price_update` / `correction` / `vendor_quote` / `other`

**UI フロー**:
1. ユーザーが override_reason にフリーテキスト入力
2. フォーカスアウト or 保存ボタン押下時に AI-C を呼び出し
3. 理由コードの候補をドロップダウンのデフォルト値として表示
4. ユーザーが承認 or 変更して保存

**Phase 1 実装範囲**:
- シンプルな分類 API（GPT-4o-mini で十分）
- ドロップダウンの候補表示
- 手動選択で上書き可能

---

## 3. Phase 2 で入れる AI 機能（優先度 D〜F）

### AI-D: 類似案件比較

**目的**: 「経験者の勘」を補う。

**入力**: 現案件の条件（lineup, tsubo, 地域, 設備）
**処理**:
1. D1 から条件が近い完了案件を SQL で 5〜10件抽出
2. 抽出結果 + 現案件データを OpenAI に渡す
3. 「今回だけ高い工種」「今回だけ低い工種」「過去に追加が出やすかった工種」を生成

**出力先**: 見積リスクセンター（UX-01）の RC 項目として表示
**UI**: COST_OVERVIEW に「類似案件と比較」パネル

---

### AI-E: 実績との差異要約

**目的**: 概算原価と実績原価の差異を構造化して分析。

**入力**: project_cost_items（概算）+ 実績データ（Phase 2 テーブル）
**処理**: 差異をカテゴリ別に集計し、AI が自然言語で要約
**出力**: 案件ごとの「実績差異レポート」（差異理由の推定含む）

---

### AI-F: 商談提示額との差異説明

**目的**: 営業・設計向けに「なぜ金額が変わったか」を説明。

**入力**: 初回提示額 + 概算原価ベース売価 + 差分要因
**処理**: AI が差異を営業向け言葉で説明文を生成
**出力例**:
> 「初回提示額 2,800万円 → 概算売価 2,950万円（+150万円）。主な要因: 外壁仕様変更（+80万円）、浄化槽設置義務（+35万円）、設備グレード差額（+25万円）、端数調整（+10万円）」

---

## 4. AI を入れない判断（明示的な除外）

以下は Phase 1 / Phase 2 ともに実装しない。

| # | 機能 | 除外理由 |
|---|------|---------|
| X-01 | 図面から完全自動積算 | 精度不十分、責任の所在が不明確 |
| X-02 | AI が原価確定 | P-10 違反。最終判断は人間 |
| X-03 | AI が自動で採用ON/OFF | データロスリスク |
| X-04 | AI が勝手に単価更新 | マスタ管理の整合性が崩れる |
| X-05 | AI によるフルオート見積生成 | 「判断支援」の設計原則に反する |

---

## 5. AI 実装のための技術要件

### 5-1. OpenAI API 設定

| 項目 | 値 |
|------|-----|
| モデル（条件チェック） | gpt-4o |
| モデル（PDF読取） | gpt-4o（Vision） |
| モデル（理由分類） | gpt-4o-mini |
| API キー管理 | Cloudflare Secret: `OPENAI_API_KEY` |
| temperature | 0（全機能共通、再現性重視） |
| max_tokens | 条件チェック: 2000、PDF読取: 4000、理由分類: 200 |
| レート制限 | アプリ層で 10req/min/user |
| タイムアウト | 30秒（Workers の CPU 時間制限外 = fetch は制限なし） |

### 5-2. エラーハンドリング

| エラー | 対応 |
|--------|------|
| OpenAI API タイムアウト | project_warnings に「AIチェック失敗」を記録。ユーザーにリトライ促す |
| レスポンス JSON パースエラー | ログ記録 + ユーザーに「AI結果を取得できませんでした」表示 |
| API キー未設定 | AI 機能ボタンを非表示（graceful degradation） |
| レート制限超過 | 429 返却 + 「しばらく待ってから再実行してください」表示 |

### 5-3. コスト管理

| 機能 | 推定コスト/回 | 月間想定回数 | 月間コスト |
|------|-------------|-------------|-----------|
| AI-A 条件チェック | ~$0.02 | ~200回 | ~$4 |
| AI-B PDF読取 | ~$0.05 | ~50回 | ~$2.5 |
| AI-C 理由分類 | ~$0.001 | ~500回 | ~$0.5 |
| **合計** | | | **~$7/月** |

---

## 6. AI 機能と既存画面の統合マッピング

> AI 機能は別画面に閉じ込めず、普段の画面に自然に溶け込ませる。

| AI 機能 | 統合先画面 | 表示方法 | Phase |
|---------|-----------|---------|-------|
| AI-A 条件漏れチェック | COST_OVERVIEW | 「AIチェック」ボタン + 見積リスクセンター | **Phase 1** |
| AI-B PDF読取 | COST_CATEGORY | 「業者見積を読込」ボタン + 確認モーダル | **Phase 1** |
| AI-C 理由分類 | COST_CATEGORY | 手修正時のドロップダウン候補 | **Phase 1** |
| AI-D 類似案件比較 | COST_OVERVIEW | 「類似案件と比較」パネル | Phase 2 |
| AI-E 実績差異要約 | PROJECT_DETAIL | 「実績レポート」タブ | Phase 2 |
| AI-F 差異説明 | COST_SUMMARY | 「差異説明を生成」ボタン | Phase 2 |

---

## 7. Phase 1 AI 実装の Step 配置

既存の実装ステップ（06_PHASE1_IMPLEMENTATION_PLAN_v3.md）との対応:

| AI 機能 | 配置 Step | 依存 | 理由 |
|---------|----------|------|------|
| AI-A 条件チェック | **Step 10** | Step 8（原価一覧画面）完了後 | COST_OVERVIEW に統合するため |
| AI-B PDF読取 | **Step 9〜10** | Step 8（工種詳細画面）完了後 | COST_CATEGORY に統合するため |
| AI-C 理由分類 | **Step 8** | Step 6（スナップショット）完了後 | 手修正UI と同時実装 |

> AI-A と AI-B は既存計画の Step 10「警告・変更履歴・AIチェック・設定」に収まる。
> AI-C は Step 8「工種詳細画面」の手修正UI実装と同時に入れるのが自然。

---

## 8. 禁止事項（AI 固有）

13_AI_DEV_TEAM_INSTRUCTIONS.md P-10 に加え:

| # | 禁止事項 |
|---|---------|
| AI-P-01 | AI の出力を project_cost_items に直接反映すること（確認画面を必ず経由） |
| AI-P-02 | AI の confidence が低い（< 0.5）結果をデフォルト値として表示すること |
| AI-P-03 | AI の API キーをフロントエンドに露出すること（必ず Workers 経由） |
| AI-P-04 | AI の system prompt にユーザーの個人情報を含めること |
| AI-P-05 | AI の結果に「確定」「決定」等の断定表現を使うこと（「候補」「提案」に限定） |

---

## 9. 成功基準（AI 機能）

| # | 基準 | 測定方法 |
|---|------|---------|
| AI-SC-01 | 条件チェックがテスト案件4件で意味のある警告を出す | 人間レビューで「有用」判定 ≥ 70% |
| AI-SC-02 | PDF 読取が業者見積から項目・金額を正しく抽出する | 抽出精度 ≥ 80%（項目名一致ベース） |
| AI-SC-03 | 理由分類が正しいコードを提案する | 分類精度 ≥ 70%（人間判定ベース） |
| AI-SC-04 | AI 機能が無効でもシステムが正常動作する | API キー未設定時の graceful degradation |
| AI-SC-05 | severity/confidence が正しく付与される | テスト案件4件で全警告に severity + confidence 付与 |
| AI-SC-06 | low confidence 警告がデフォルト非表示 | confidence < 0.5 の警告が折りたたみ状態 |

---

## 10. KPI 責任者マッピング

> 16_UX_RISK_PREVENTION_DESIGN.md KPI-01〜KPI-06 の各指標に責任者を設定し、改善サイクルを回す。

| KPI | 指標名 | 主担当責任者 | 改善アクション |
|-----|--------|------------|---------------|
| KPI-01 | 見積漏れ警告件数 | **積算責任者**（estimator） | 警告が繰り返される工種 → ルール追加 or AI プロンプト改善 |
| KPI-02 | 手修正率 | **管理者**（manager） | 手修正率が高い工種 → マスタ単価見直し or 計算ロジック改善 |
| KPI-03 | 再生成差分の確認漏れ率 | **積算責任者**（estimator） | diff 未確認のまま案件進行 → 運用ルール見直し |
| KPI-04 | 商談提示額との乖離件数 | **営業責任者**（manager） | 乖離が頻発 → 粗利率設定の見直し or 営業への事前共有ルール |
| KPI-05 | AI 警告の採用率 | **運用改善担当**（admin） | 採用率が低い → AI プロンプト精度改善 or 不要パターン除外 |
| KPI-06 | 入力完了率 | **積算責任者**（estimator） | 入力率が低い案件 → ステップ式UI の必須項目見直し |

### KPI 運用サイクル

```
月次レビュー:
1. admin が DASHBOARD の管理者向け集計セクション（UX-05）を確認
2. KPI-01〜06 の数値を確認し、悪化傾向を特定
3. 責任者が改善アクションを決定
4. 次月レビューで効果を検証
```

---

*最終更新: 2026-03-07*
*改訂番号: v2（正式改訂 — severity/confidence/推奨アクション体系追加、KPI責任者設定、low confidence表示ポリシー明確化、PDF確認画面フロー強化）*
*位置づけ: 16_UX_RISK_PREVENTION_DESIGN.md と対をなす AI 活用設計。13_AI_DEV_TEAM_INSTRUCTIONS.md の AI 方針補完。*
*前提ドキュメント: 03_SCREEN_v3, 04_OPENAI_API, 13_AI_DEV_v3, 16_UX_RISK_PREVENTION_v2*
