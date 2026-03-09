# UI/UX 改善計画書
## 平松建築 概算原価管理システム

**作成日**: 2026-03-09  
**制約条件**: DB設計・マイグレーション・API・依存関係に影響を与えない。純粋にフロントエンド（`src/routes/ui.ts`）のHTMLテンプレート・Alpine.jsロジック・CSS のみの変更。

---

## 改善の3原則

| # | 原則 | 現状の課題 |
|---|------|-----------|
| 1 | **情報量は多いのに、優先順位が見えにくい** | 7タブが同列に並び、どこから見るべきか分からない |
| 2 | **専門用語がそのまま出て、文脈で伝わらない** | 「売価見積」「差分解決」「原価サマリ」が初見に難しい |
| 3 | **表が強く、案内が弱い** | 一覧・テーブルは整っているが「ここで何をする場所か」がない |

---

## 優先度定義

| 優先度 | 定義 | 影響範囲 |
|--------|------|----------|
| **P1** | これだけで体感が大きく変わる。全画面共通の改善 | 全ページ |
| **P2** | 各画面固有の視認性・使いやすさ改善 | 個別画面 |
| **P3** | 次フェーズで入れる機能的改善（ルール複製等） | 管理画面 |

---

## P1: 最優先改善（全画面共通）

### P1-1: 各画面・タブに「この画面でやること」ガイドライン追加

**対象**: 全画面の最上部（タブコンテンツの先頭）  
**方針**: 1行の説明文を薄いバナーとして常時表示。閉じるボタンは付けない（常に見える状態）。  
**実装方式**: 各タブの `<div x-show="activeTab === '...'">` 直後に説明バナーを追加。

| 画面/タブ | 現状 | 追加する説明（1行） |
|-----------|------|---------------------|
| 案件一覧 (`/ui/projects`) | 「見積案件の管理・作成」 | **「案件を作成し、進行中の案件を開く画面です」** |
| 建物条件 (edit) | 説明なし | **「建物条件を入力する画面です。ここを変えると原価計算に影響します」** |
| 工種別原価 (items) | 説明なし | **「自動計算された各工種の金額を確認・手修正する画面です」** |
| 原価集計 (summary) | 説明なし | **「カテゴリごとの原価合計を見る画面です。コスト構成を把握します」** |
| 売価・粗利 (sales) | 説明なし | **「お客様に提示する予定金額を入力し、粗利を確認する画面です」** |
| 再計算差分 (diffs) | 説明なし | **「再計算で変わった工種だけを確認し、採用するか決める画面です」** |
| リスクセンター (risk) | 説明なし | **「この案件の注意点・未完了項目をまとめた画面です。上から順に確認してください」** |
| 警告・確認事項 (ai) | 説明なし | **「AIとルールが検出した警告を確認・解決する画面です」** |
| 管理画面 (`/ui/admin`) | 「ユーザー管理・マスタ設定」 | **「システム全体の設定を管理する画面です。admin権限が必要です」** |

**HTML パターン**:
```html
<div class="bg-gray-50 border-b border-gray-200 rounded-t-lg px-4 py-2.5 mb-4 flex items-center gap-2">
  <i class="fas fa-info-circle text-hm-500 text-xs"></i>
  <span class="text-xs text-gray-600">建物条件を入力する画面です。ここを変えると原価計算に影響します</span>
</div>
```

**変更箇所**: `src/routes/ui.ts`  
- L160付近: 案件一覧のh1サブタイトル変更  
- L328付近: risk タブ直後  
- L373付近: items タブ直後  
- L376付近: edit タブ直後  
- L609付近: diffs タブ直後  
- L654付近: summary タブ直後  
- L678付近: sales タブ直後  
- L731付近: ai タブ直後  
- L1047付近: admin画面サブタイトル  

---

### P1-2: タブ名の見直し（案件詳細）

**対象**: `src/routes/ui.ts` L881-889 のタブ定義配列

| 現在のID | 現在のラベル | 新しいラベル | 理由 |
|----------|-------------|-------------|------|
| `risk` | リスクセンター | **リスクセンター** | そのまま（分かりやすい） |
| `edit` | 案件情報 | **建物条件** | 「情報」は曖昧。入力するのは建物の条件 |
| `items` | 工種明細 | **工種別原価** | 「明細」は帳票用語。実務では「各工種の原価」 |
| `diffs` | 差分解決 | **再計算差分** | 「差分解決」は技術用語。いつ使うかが伝わる名称に |
| `summary` | 原価サマリ | **原価集計** | 「サマリ」は英語。「集計」なら一瞬で伝わる |
| `sales` | 売価見積 | **売価・粗利** | 「見積」が二重意味になる。目的は粗利確認 |
| `ai` | AI・警告 | **警告・確認事項** | AIが主語より、何がある画面かを伝える |

**変更箇所**: `src/routes/ui.ts` L881-889  
```javascript
tabs: [
  { id:'risk', label:'リスクセンター', icon:'fas fa-shield-alt', badge:0, badgeColor:'bg-red-500 text-white' },
  { id:'edit', label:'建物条件', icon:'fas fa-edit', badge:0, badgeColor:'' },
  { id:'items', label:'工種別原価', icon:'fas fa-list-alt', badge:0, badgeColor:'bg-gray-200 text-gray-600' },
  { id:'summary', label:'原価集計', icon:'fas fa-chart-pie', badge:0, badgeColor:'' },
  { id:'sales', label:'売価・粗利', icon:'fas fa-yen-sign', badge:0, badgeColor:'' },
  { id:'diffs', label:'再計算差分', icon:'fas fa-code-compare', badge:0, badgeColor:'bg-orange-500 text-white' },
  { id:'ai', label:'警告・確認事項', icon:'fas fa-bell', badge:0, badgeColor:'bg-purple-500 text-white' },
],
```

**タブの並び順変更**:  
現在: risk → edit → items → diffs → summary → sales → ai  
改善後: risk → edit → items → summary → sales → diffs → ai

**考え方**: 日常導線（risk → edit → items → summary → sales）を先に、例外対応導線（diffs → ai）を後に。ユーザーは左から順に見る習慣があるため、使用頻度の高い順に並べる。

---

### P1-3: リスクセンターを「やること順」に再構成

**現状** (L328-370): リスク項目がフラットにカード表示されている。  
**課題**: 「次に何をすべきか」が見えない。

**改善方針**:
1. 4つのサマリカード（リスクレベル/入力完了率/レビュー進捗/粗利率）はそのまま維持
2. リスク項目を以下の3段階に分離表示:

```
■ 今すぐ対応（error + action_required=true）
  → 赤背景、太字、アイコン付き
  例: 「売価が原価を下回っています」

■ できれば対応（warning）
  → 黄色背景
  例: 「ラインナップ未定の工種を手動確認してください」

■ 参考情報（info）
  → 水色背景、小さめ
  例: 「坪数が未入力です」
```

3. 先頭に「次にやること TOP 3」カードを追加:

```html
<div class="bg-white rounded-xl border-2 border-hm-200 p-4 mb-5">
  <h3 class="text-sm font-bold text-hm-700 mb-2">
    <i class="fas fa-hand-point-right mr-1"></i>次にやること
  </h3>
  <div class="space-y-2">
    <!-- action_required=true の上位3件のみ -->
    <template x-for="r in (risk?.risks || []).filter(r=>r.action_required).slice(0,3)">
      <div class="flex items-center gap-2 text-sm">
        <span class="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
          <i class="fas fa-exclamation text-red-500 text-xs"></i>
        </span>
        <span x-text="r.title" class="text-gray-800"></span>
      </div>
    </template>
    <div x-show="!(risk?.risks || []).some(r=>r.action_required)" class="text-sm text-green-600">
      <i class="fas fa-check-circle mr-1"></i>現在、緊急の対応事項はありません
    </div>
  </div>
</div>
```

**変更箇所**: `src/routes/ui.ts` L328-370  
- L330-352: サマリカード → そのまま  
- L353以降: リスク一覧 → 3グループに分離 + 「次にやること」カード追加

---

### P1-4: 売価見積の説明強化

**現状** (L678-728): 入力欄のラベルが「売価合計」「標準売価」「太陽光売価」のみ。  
**課題**: 原価・売価・粗利の関係が初見に伝わらない。

**改善内容**:
1. 入力欄の上に概念説明を追加:

```html
<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-700">
  <div class="grid grid-cols-3 gap-4 text-center">
    <div><div class="font-bold">原価</div><div>工事にかかる費用</div></div>
    <div><div class="font-bold">売価</div><div>お客様に提示する価格</div></div>
    <div><div class="font-bold">粗利</div><div>売価 − 原価 = 利益</div></div>
  </div>
</div>
```

2. ラベル変更:

| 現在 | 変更後 |
|------|--------|
| 売価合計 | **提示予定金額（税抜売価合計）** |
| 標準売価 | **本体工事の提示金額** |
| 太陽光売価 | **太陽光の提示金額** |

**変更箇所**: `src/routes/ui.ts` L679-686

---

### P1-5: 差分解決の空画面説明追加

**現状** (L618): `未解決の差分はありません` のみ。  
**課題**: 何のための画面か、いつ使うかが伝わらない。

**改善内容**:
```html
<div x-show="diffs.length === 0 && !diffsLoading" class="bg-white rounded-xl border p-12 text-center">
  <i class="fas fa-check-circle text-4xl text-green-400 mb-3"></i>
  <p class="text-lg font-medium text-gray-600">差分はありません</p>
  <div class="mt-4 text-sm text-gray-400 max-w-md mx-auto space-y-1">
    <p>建物条件やラインナップを変更して再計算した時だけ使う画面です。</p>
    <p>前回計算と今回計算で変わった工種を比較します。</p>
    <p class="text-green-500 font-medium">差分がない場合は、ここでの作業は不要です。</p>
  </div>
</div>
```

**変更箇所**: `src/routes/ui.ts` L618

---

## P2: 各画面固有の改善

### P2-1: 案件一覧の空画面ガイド改善

**現状** (L200-202): `案件がありません` のみ。  
**課題**: 次の行動が分からない。

**改善内容**:
```html
<div x-show="!loading && projects.length === 0" class="bg-white rounded-xl border p-12 text-center">
  <i class="fas fa-inbox text-5xl text-gray-200 mb-4"></i>
  <p class="text-lg font-medium text-gray-600 mb-2">案件がありません</p>
  <p class="text-sm text-gray-400 mb-6">まずは新規案件を作成してください</p>
  <button @click="showCreate = true" class="bg-hm-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-hm-700 transition shadow-sm">
    <i class="fas fa-plus mr-1.5"></i>最初の案件を作成
  </button>
  <div class="mt-8 flex justify-center">
    <div class="flex items-center gap-4 text-xs text-gray-400">
      <div class="flex items-center gap-1"><span class="w-6 h-6 rounded-full bg-hm-100 flex items-center justify-center text-hm-600 font-bold text-xs">1</span>案件作成</div>
      <i class="fas fa-chevron-right text-gray-300"></i>
      <div class="flex items-center gap-1"><span class="w-6 h-6 rounded-full bg-hm-100 flex items-center justify-center text-hm-600 font-bold text-xs">2</span>建物条件入力</div>
      <i class="fas fa-chevron-right text-gray-300"></i>
      <div class="flex items-center gap-1"><span class="w-6 h-6 rounded-full bg-hm-100 flex items-center justify-center text-hm-600 font-bold text-xs">3</span>初期計算</div>
      <i class="fas fa-chevron-right text-gray-300"></i>
      <div class="flex items-center gap-1"><span class="w-6 h-6 rounded-full bg-hm-100 flex items-center justify-center text-hm-600 font-bold text-xs">4</span>工種確認</div>
    </div>
  </div>
</div>
```

**変更箇所**: `src/routes/ui.ts` L200-202

---

### P2-2: ステータスフィルタの意味補足

**対象**: 案件一覧のフィルタボタン (L167-175)  
**方針**: ツールチップ（title属性）でステータスの意味を補足。

| ステータス | 追加するtitle |
|-----------|--------------|
| 全件 | `全ての案件を表示` |
| 下書き | `初期計算前の案件` |
| 進行中 | `計算済み・調整中の案件` |
| 要レビュー | `上長確認待ちの案件` |
| レビュー済 | `確認完了の案件` |

**変更箇所**: `src/routes/ui.ts` L167-175 の `<button>` に `:title` 属性追加

---

### P2-3: 工種明細の視認性改善

**対象**: items タブ内のテーブル  
**現状課題**: 長い表で視線誘導がない。0円の工種と手動修正済みの区別が弱い。

**改善内容**:

1. **上部に使い方説明を固定表示**:
```
「自動計算額を確認し、必要な工種は鉛筆アイコンで修正します」
```

2. **状態列の色付き説明バッジ**:

| 状態 | バッジ色 | 説明 |
|------|---------|------|
| pending (未確認) | グレー | まだ確認していない |
| confirmed (確認済) | 緑 | 内容確認済み |
| needs_review (要確認) | 黄 | 後で見直し |
| adjusted (修正済) | 青 | 手動修正が反映された |

3. **0円の工種は行全体を薄く（opacity-40）**
4. **手動修正済み行は左ボーダーにオレンジ色**:
```css
/* 手動修正済み行 */
border-left: 3px solid #f97316;
background-color: rgba(255, 237, 213, 0.3);
```

**変更箇所**: items タブのテンプレート内 `<tr>` の `:class` バインディング追加

---

### P2-4: 原価集計の上位カテゴリ強調

**対象**: summary タブ (L654-675)  
**現状課題**: 表だけで「何を見る画面か」が不明。

**改善内容**:

1. **上部に説明1行追加**:
```
「カテゴリごとの原価構成を確認する画面です。どこにコストが偏っているかを見ます」
```

2. **上位3カテゴリをカード表示**（4つのサマリカードの下に追加）:
```html
<div class="grid grid-cols-3 gap-3 mb-4">
  <template x-for="s in summaries.slice().sort((a,b)=>b.final_total_amount - a.final_total_amount).slice(0,3)">
    <div class="bg-white rounded-lg border-2 border-hm-200 p-3 text-center">
      <div class="text-xs text-gray-500" x-text="s.category_code"></div>
      <div class="text-lg font-bold text-hm-700" x-text="fmt.yen(s.final_total_amount)"></div>
      <div class="text-xs text-gray-400" x-text="snapshot?.total_cost ? Math.round(s.final_total_amount / snapshot.total_cost * 100) + '% of total' : ''"></div>
    </div>
  </template>
</div>
```

3. **構成比が20%以上のカテゴリに強調背景**:  
テーブル行の `:class` に条件追加:
```
比率20%以上 → bg-hm-50/50（ハイライト）
```

**変更箇所**: `src/routes/ui.ts` L654-675

---

### P2-5: 管理画面・単価マスタの計算方法色分け

**対象**: admin画面の単価マスタテーブル  
**現状課題**: 計算方法の列がテキストのみで、どれが固定額・面積ベース・ルール参照かが一目で分からない。

**改善内容**:  
計算方法の表示を色付きバッジに変更:

| 計算方法 | バッジ色 | ラベル |
|---------|---------|-------|
| per_m2, per_tsubo, per_meter | 青 | 面積系 |
| fixed_amount, lineup_fixed | 緑 | 固定額 |
| rule_lookup, range_lookup | 紫 | ルール参照 |
| manual_quote | オレンジ | 手動見積 |
| product_selection | グレー | 商品選択 |
| threshold_surcharge, package_with_delta | 水色 | 加算系 |

**追加**: テーブル上部に注意書き  
```
「この単価を変えると、次回の再計算から反映されます」
```

**変更箇所**: admin画面の masterItems テーブル内 `calcLabel` 呼び出し箇所

---

## P3: 次フェーズ機能的改善（今回は計画のみ）

### P3-1: ルール複製機能

**目的**: 既存ルールをコピーして微修正するニーズ（坪数帯の追加等）  
**UI**: ルール一覧テーブルの操作列に「複製」ボタン追加  
**API**: 不要（POST /api/master/rules で新規作成するだけ）  
**実装方針**: `openRuleEdit(rule)` と同様に JSON をパースし、`ruleModal.isNew = true` で開く。IDは自動生成。

### P3-2: ルールテスト実行機能

**目的**: ルールを変更した後、特定の案件条件で「このルールは発火するか」を確認したい  
**UI**: ルール編集モーダル下部に「テスト実行」ボタン追加。条件入力欄（ラインナップ、坪数等）を表示。  
**API**: `POST /api/master/rules/test` — evaluateConditions のみ実行して結果を返す（データ変更なし）  
**影響**: 新規APIが必要なため、P3に分類

### P3-3: 変更履歴UI

**目的**: 単価やルールの変更履歴を管理画面で閲覧  
**データ**: `master_change_logs` テーブルに既にデータは蓄積中  
**UI**: 単価マスタの各アイテムに「履歴」ボタン → モーダルで変更一覧表示  
**API**: `GET /api/master/items/:id/change-logs`（新規API）

### P3-4: ルール影響プレビュー

**目的**: ルールを変更/追加する前に、既存案件への影響範囲を確認したい  
**UI**: ルール編集モーダルに「影響プレビュー」タブ  
**API**: `POST /api/master/rules/impact` — 全active案件に対してdry-run（新規API）

---

## 実装順序（チケット単位）

### Phase 1: P1 全項目（推定作業量: 中）

| # | チケット | 対象ファイル | 変更量(目安) |
|---|---------|-------------|-------------|
| 1-1 | ガイドライン1行追加（全9箇所） | ui.ts | +30行 |
| 1-2 | タブ名変更 + 並び順変更 | ui.ts | ~10行変更 |
| 1-3 | リスクセンター再構成（3段階グループ化 + 「次にやること」） | ui.ts | +40行, ~20行変更 |
| 1-4 | 売価見積の説明強化 + ラベル変更 | ui.ts | +15行, ~5行変更 |
| 1-5 | 差分解決の空画面説明 | ui.ts | ~10行変更 |

**合計推定**: +95行追加, ~45行変更  
**リスク**: なし（表示のみの変更、データフローに影響なし）  
**テスト**: 全タブの表示確認、JSエラーなし確認

### Phase 2: P2 全項目（推定作業量: 中〜大）

| # | チケット | 対象ファイル | 変更量(目安) |
|---|---------|-------------|-------------|
| 2-1 | 案件一覧 空画面ガイド + ステップ表示 | ui.ts | ~20行変更 |
| 2-2 | ステータスフィルタ ツールチップ | ui.ts | ~5行変更 |
| 2-3 | 工種明細 視認性改善（色分け、0円薄化、手動修正ハイライト） | ui.ts | +20行, ~15行変更 |
| 2-4 | 原価集計 上位3カテゴリ強調 + 説明 | ui.ts | +25行, ~5行変更 |
| 2-5 | 管理画面 単価マスタ 計算方法色分け | ui.ts | +10行, ~10行変更 |

**合計推定**: +55行追加, ~55行変更  
**リスク**: なし  
**テスト**: Phase 1 と同一

### Phase 3: P3（今回は実装しない、次回以降）

| # | チケット | 必要なAPI変更 |
|---|---------|-------------|
| 3-1 | ルール複製 | なし（既存POST利用） |
| 3-2 | ルールテスト実行 | 新規API 1本 |
| 3-3 | 変更履歴UI | 新規API 1本 |
| 3-4 | ルール影響プレビュー | 新規API 1本 |

---

## 変更対象ファイル一覧

| ファイル | 変更内容 | Phase |
|---------|---------|-------|
| `src/routes/ui.ts` | 全UI変更 | 1, 2 |

**変更しないもの**（安全性の担保）:
- `src/routes/master.ts` — API変更なし
- `src/routes/projects.ts` — API変更なし
- `src/routes/riskCentre.ts` — ロジック変更なし
- `src/engine/*.ts` — 計算エンジン変更なし
- `src/schemas/*.ts` — バリデーション変更なし
- `src/middleware/*.ts` — 認証変更なし
- `migrations/*.sql` — DB変更なし
- `wrangler.jsonc` — インフラ変更なし
- `package.json` — 依存関係変更なし

---

## 画面ごとの完成イメージ要約

### 案件一覧
- 空画面: 「まずは新規案件を作成してください」+ 4ステップガイド + 作成ボタン
- フィルタボタン: ツールチップでステータスの意味を表示

### 案件詳細（タブ構成）
```
[リスクセンター] [建物条件] [工種別原価] [原価集計] [売価・粗利] ‖ [再計算差分] [警告・確認事項]
     ↑ 日常導線（左から順に見る）                              ↑ 例外対応（必要な時だけ）
```
- 各タブ先頭: 「この画面でやること」1行ガイド

### リスクセンター
- 先頭: 「次にやること TOP 3」（action_required の上位3件）
- 3段階グループ: 今すぐ対応 → できれば対応 → 参考情報

### 売価・粗利
- 上部: 原価/売価/粗利の概念図
- ラベル: 「提示予定金額」「本体工事の提示金額」等

### 工種別原価
- 上部ガイド: 「自動計算額を確認し、必要な工種は鉛筆アイコンで修正します」
- 0円行: 薄く表示
- 手動修正行: オレンジ左ボーダー

### 原価集計
- 上部ガイド + 上位3カテゴリのカード強調
- 構成比20%以上の行: ハイライト

### 再計算差分
- 空画面: 「いつ使う画面か」の詳細説明

### 管理画面
- 単価マスタ: 計算方法を色付きバッジ化
- 注意書き: 「この単価を変えると次回再計算から反映されます」

---

## 判断基準: この計画で変えないもの

| 項目 | 理由 |
|------|------|
| APIレスポンス構造 | フロント側の表示変更のみで対応 |
| DBスキーマ | テーブル・カラム変更なし |
| 認証・認可ロジック | 権限チェック変更なし |
| 計算エンジン | snapshotGenerator / regenerateEngine 変更なし |
| ルーティング | URLパス変更なし |
| 依存パッケージ | package.json 変更なし |
| Cloudflare設定 | wrangler.jsonc 変更なし |

**結論**: `src/routes/ui.ts` 1ファイルのみの変更で、全改善を実装可能。
