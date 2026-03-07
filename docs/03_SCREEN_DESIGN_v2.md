# 画面設計・画面遷移図 v2（改訂版）

> **改訂履歴**:
> - v1: 初版作成
> - v2: 09_CROSS_REVIEW_PHASE2.md NEW-06 を反映。37工種統一、オプション粗利率UIの追加、バージョン管理API定義追加、AI条件チェックをPhase 1に移動、再計算API定義追加、ヘルスチェックAPI追加、categoryIdパラメータの型を明確化。

## 画面一覧

### Phase 1 必須画面

| # | 画面ID | 画面名 | 主な用途 | URL |
|---|--------|--------|---------|-----|
| 1 | LOGIN | ログイン | 認証 | `/login` |
| 2 | DASHBOARD | ダッシュボード | 案件一覧・概要 | `/` |
| 3 | PROJECT_NEW | 案件新規作成 | 基本情報入力 | `/projects/new` |
| 4 | PROJECT_DETAIL | 案件詳細 | 基本情報表示・編集 | `/projects/:id` |
| 5 | COST_OVERVIEW | 原価一覧 | 全工種の原価サマリー | `/projects/:id/costs` |
| 6 | COST_CATEGORY | 工種詳細 | 工種内の明細一覧 | `/projects/:id/costs/:categoryCode` |
| 7 | COST_SUMMARY | 原価サマリー | 原価合計・粗利率 | `/projects/:id/summary` |
| 8 | MASTER_CATEGORIES | 工種マスタ管理 | 工種の追加・編集 | `/master/categories` |
| 9 | MASTER_ITEMS | 明細マスタ管理 | 単価表の管理 | `/master/items` |
| 10 | MASTER_PRODUCTS | 商品カタログ管理 | サッシ・建具等 | `/master/products` |
| 11 | MASTER_RULES | ルール管理 | 条件ルール・数量ルール | `/master/rules` |
| 12 | CHANGE_LOG | 変更履歴 | マスタ変更・案件変更 | `/logs` |

> **v2変更点**: COST_CATEGORY のURLパラメータを `:categoryId` → `:categoryCode` に変更（DB側がTEXT PKのため、`foundation` 等のcategory_codeをURL上で使用）

### Phase 2 追加予定画面

| # | 画面ID | 画面名 | 用途 |
|---|--------|--------|------|
| 13 | AI_IMPORT | AI資料読取 | PDF/画像から明細抽出 |
| 14 | AREA_RULES | 地域ルール管理 | 自治体別ルール |
| 15 | USER_MGMT | ユーザー管理 | 権限管理 |
| 16 | COMPARISON | 比較画面 | 商談概算vs社内原価 |

> **v2変更点**: AI_CHECK（AI条件チェック）をPhase 2から削除し、Phase 1のCOST_OVERVIEW内の機能として統合（06_v2と整合）

---

## 画面遷移図

```
[LOGIN] ──認証成功──> [DASHBOARD]
                          │
                ┌─────────┼──────────┐
                │         │          │
                ▼         ▼          ▼
         [PROJECT_NEW] [案件選択]  [マスタ管理]
                │         │          │
                │         ▼          ├─> [MASTER_CATEGORIES]
                │   [PROJECT_DETAIL] ├─> [MASTER_ITEMS]
                │         │          ├─> [MASTER_PRODUCTS]
                │         ▼          ├─> [MASTER_RULES]
                │   [COST_OVERVIEW]  └─> [CHANGE_LOG]
                │         │
                │    ┌────┼────┐
                │    │    │    │
                │    ▼    ▼    ▼
                │  [工種1] [工種2] [工種N]
                │  (COST_CATEGORY)
                │         │
                │         ▼
                └──> [COST_SUMMARY]
```

---

## 各画面の詳細設計

### 1. ダッシュボード (DASHBOARD) `/`

**目的：** 全案件の状況を一目で把握し、対応が必要な案件をすぐ見つける

#### レイアウト（v1と同一）

```
┌─────────────────────────────────────────────────────┐
│ [ヘッダー] 平松建築 原価管理システム    [ユーザー名] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ [サマリーカード 4枚]                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │ 進行中    │ │ 要確認    │ │ 今月完了  │ │ 平均粗利  │ │
│ │ 12件     │ │ 5件      │ │ 3件      │ │ 28.5%   │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                     │
│ [マスタ変更通知バナー] ※v2追加                        │
│ ℹ 基礎工事の単価が更新されました（3件の案件に影響）   │
│                                                     │
│ [フィルター] ステータス▼ ラインナップ▼ 担当者▼      │
│ [＋新規案件作成]                        [検索]       │
│                                                     │
│ ┌───────────────────────────────────────────────────┐│
│ │案件コード│案件名│顧客名│ラインナップ│坪数│原価合計│粗利率│ステータス│未確認││
│ ├────────┼────┼────┼──────┼──┼──────┼───┼────┼───┤│
│ │2026-001│佐藤邸│佐藤様│SHIN    │35│18,500K│29.2%│進行中│3件││
│ │2026-002│田中邸│田中様│MOKU_HIRAYA│28│14,200K│31.0%│確認済│0件││
│ │2026-003│鈴木邸│鈴木様│RIN     │42│22,800K│27.8%│要確認│7件││
│ └───────────────────────────────────────────────────┘│
│                                                     │
│ [ページネーション]                                    │
└─────────────────────────────────────────────────────┘
```

> **v2追加**: マスタ変更通知バナー（O-01対応）、案件コード列追加（O-03対応）

---

### 2. 案件新規作成 (PROJECT_NEW) `/projects/new`

**目的：** 案件の基礎情報を入力し、自動計算の前提条件を確定する

#### レイアウト（v2修正箇所のみ記載）

```
── 粗利率設定 ──  ※v2: オプション粗利率を追加
基本粗利率:   [30.0]%
太陽光粗利率: [25.0]%
オプション粗利率: [30.0]%    ← v2追加
```

> **v2変更点**: `option_gross_margin_rate` の入力フィールドを追加（projects テーブルに対応カラムあり）

その他のフィールドはv1と同一。

---

### 3. 原価サマリー (COST_SUMMARY) `/projects/:id/summary`

**v2修正箇所：**

```
── 確認状況 ──
全37工種中:                                     ← v2修正: 35→37
 ✅ 確認済み: 28  ⚠ 要確認: 4  ⬜ 未着手: 5

── 原価構成 ──

[標準工事原価]
 自動計算合計:    17,250,000
 手修正合計:       +432,000
 標準工事原価合計: 17,682,000

[太陽光工事原価]
 太陽光原価合計:    1,100,000

[オプション原価]
 オプション原価合計:  175,000

── 売価・粗利計算 ──

┌──────────────────┬──────────┬──────────┬─────────┐
│区分              │原価      │粗利率    │売価     │
├──────────────────┼──────────┼──────────┼─────────┤
│標準工事          │17,682,000│30.0%    │25,260,000│
│太陽光            │ 1,100,000│25.0%    │ 1,466,667│
│オプション        │   175,000│30.0%    │   250,000│   ← v2: 粗利率カスタム可能
├──────────────────┼──────────┼──────────┼─────────┤
│合計              │18,957,000│29.7%    │26,976,667│
└──────────────────┴──────────┴──────────┴─────────┘
```

---

## API設計（主要エンドポイント）v2改訂版

### 案件関連

| Method | Path | 説明 | v2変更 |
|--------|------|------|--------|
| GET | `/api/projects` | 案件一覧 | - |
| POST | `/api/projects` | 案件作成（案件コード自動採番含む） | v2: 自動採番 |
| GET | `/api/projects/:id` | 案件詳細 | - |
| PUT | `/api/projects/:id` | 案件更新 | v2: 楽観ロック |
| POST | `/api/projects/:id/calculate` | 原価計算（初回・全体） | - |
| **POST** | **`/api/projects/:id/recalculate`** | **全工種再計算** | **v2追加** |
| **POST** | **`/api/projects/:id/recalculate/:categoryCode`** | **個別工種再計算** | **v2追加** |
| GET | `/api/projects/:id/costs` | 工種別原価一覧 | - |
| GET | `/api/projects/:id/costs/:categoryCode` | 工種詳細明細 | v2: パラメータ名変更 |
| PUT | `/api/projects/:id/costs/:itemId` | 明細更新（手修正） | v2: 楽観ロック |
| POST | `/api/projects/:id/costs/:categoryCode/items` | 明細追加 | v2: パラメータ名変更 |
| GET | `/api/projects/:id/summary` | 原価サマリー | - |
| GET | `/api/projects/:id/warnings` | 警告一覧 | - |
| PUT | `/api/projects/:id/warnings/:id/resolve` | 警告解決 | - |
| GET | `/api/projects/:id/logs` | 変更履歴 | - |

### マスタ関連

| Method | Path | 説明 | v2変更 |
|--------|------|------|--------|
| GET | `/api/master/categories` | 工種マスタ一覧 | - |
| POST | `/api/master/categories` | 工種追加 | - |
| PUT | `/api/master/categories/:id` | 工種更新 | - |
| GET | `/api/master/items` | 明細マスタ一覧 | - |
| POST | `/api/master/items` | 明細追加 | - |
| PUT | `/api/master/items/:id` | 明細更新 | - |
| **GET** | **`/api/master/items/:id/versions`** | **バージョン一覧** | **v2追加** |
| **POST** | **`/api/master/items/:id/versions`** | **新バージョン追加** | **v2追加** |
| **GET** | **`/api/master/items/:id/versions/current`** | **現在有効バージョン** | **v2追加** |
| GET | `/api/master/products` | 商品カタログ一覧 | - |
| POST | `/api/master/products` | 商品追加 | - |
| PUT | `/api/master/products/:id` | 商品更新 | - |
| GET | `/api/master/rules` | ルール一覧 | - |
| GET | `/api/master/logs` | マスタ変更履歴 | - |

### マスタ変更通知（v2追加: O-01対応）

| Method | Path | 説明 |
|--------|------|------|
| **GET** | **`/api/master/changes/recent`** | 直近のマスタ変更一覧 |
| **GET** | **`/api/master/changes/:id/affected-projects`** | 影響案件一覧 |

### AI関連（v2: Phase 1に移動）

| Method | Path | 説明 | v2変更 |
|--------|------|------|--------|
| POST | `/api/ai/extract-from-pdf` | PDF読取→明細抽出 | Phase 2 |
| **POST** | **`/api/ai/check-conditions`** | **条件漏れチェック** | **v2: Phase 1に移動** |
| POST | `/api/ai/suggest-items` | 明細候補提案 | Phase 2 |

> **v2変更点**: `check-conditions` を Phase 2 → Phase 1 に移動。06_PHASE1_IMPLEMENTATION_PLAN_v2.md Step 9 と整合。

### 管理・ヘルスチェック（v2追加）

| Method | Path | 説明 |
|--------|------|------|
| **GET** | **`/api/health`** | サービスヘルスチェック |
| **POST** | **`/api/admin/seed/validate`** | シードデータ検証 |
| **POST** | **`/api/admin/seed/import`** | シードデータ投入 |

---

## APIパラメータ仕様（v2追加）

### ページネーション共通パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|----------|-----|----------|------|
| `page` | INTEGER | 1 | ページ番号 |
| `per_page` | INTEGER | 20 | 1ページあたりの件数（最大100） |
| `sort` | TEXT | `created_at` | ソート対象カラム |
| `order` | TEXT | `desc` | ソート順（`asc` / `desc`） |

### GET `/api/projects` 固有パラメータ

| パラメータ | 型 | 説明 |
|----------|-----|------|
| `status` | TEXT | ステータスフィルタ（カンマ区切りで複数指定可） |
| `lineup` | TEXT | ラインナップフィルタ |
| `search` | TEXT | 案件名・顧客名のあいまい検索 |
| `assigned_to` | INTEGER | 担当者IDフィルタ |

### 楽観ロック対応（v2追加: O-02）

PUT/POSTリクエスト時に `version` パラメータを含める。サーバー側で現在のバージョンと比較し、不一致の場合は **409 Conflict** を返す。

**リクエスト例**:
```json
PUT /api/projects/1
{
  "project_name": "佐藤邸（更新）",
  "version": 3
}
```

**409レスポンス例**:
```json
{
  "error": "conflict",
  "message": "データが他のユーザーにより更新されています。画面をリロードしてください。",
  "current_version": 4
}
```

---

## レスポンシブ対応方針

### デスクトップ（主要ターゲット）
- 原価計算はデスクトップでの作業が前提
- テーブル表示、インライン編集

### タブレット
- 一覧表示は横スクロール対応
- 編集は別画面遷移

### スマホ
- ダッシュボードの閲覧のみ
- 詳細編集は非対応（デスクトップ推奨メッセージ）

---

*最終更新: 2026-03-07*
*改訂番号: v2（09_CROSS_REVIEW_PHASE2 NEW-06反映）*
