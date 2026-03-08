# 平松建築 概算原価管理システム - 運用手順書

**バージョン**: 0.8.0-step8  
**更新日**: 2026-03-08  
**対象者**: システム管理者、プロジェクト責任者

---

## 1. システム概要

| 項目 | 内容 |
|------|------|
| システム名 | 平松建築 概算原価管理システム (Hiramatsu Cost) |
| 目的 | 注文住宅の概算原価を自動算出し、売価ギャップ分析・リスク可視化を行う |
| プラットフォーム | Cloudflare Pages + Workers + D1 |
| フレームワーク | Hono (TypeScript) |
| データベース | Cloudflare D1 (SQLite互換) |
| AI連携 | OpenAI GPT-4o (オプション / 未設定時はrule-basedフォールバック) |

---

## 2. 日常運用手順

### 2.1 ヘルスチェック

```bash
# 本番環境
curl https://<project-name>.pages.dev/api/health
# 期待応答: {"status":"ok","version":"0.8.0-step8","phase":"step-8-cr03-cr05-deploy-prep"}

# AI状態確認
curl https://<project-name>.pages.dev/api/ai/status
# 期待応答: {"ai_available":true/false, "mode":"ai_enhanced"/"rule_based", ...}
```

### 2.2 案件作成フロー (標準)

1. **案件登録**: `POST /api/projects` で新規案件を作成
   - 必須: `project_code`, `project_name`
   - 推奨: `lineup`, `tsubo`, `building_area_m2`, `prefecture`, `city`
2. **案件編集**: `PATCH /api/projects/:id` またはUI編集タブから
   - lineup, 坪数, 面積, 断熱等級, 防火条件, 屋根形状, 顧客名, 自治体など
3. **スナップショット生成**: `POST /api/projects/:id/snapshots`
   - 入力情報を元にマスタデータから原価58工種を自動算出
4. **売価見積入力**: `POST /api/projects/:id/sales-estimate`
   - 標準/ソーラー/オプション各マージンと売価を入力
5. **ギャップ分析確認**: `GET /api/projects/:id/gap-analysis`
   - margin_deviation = expected_margin - actual_margin
   - 正値→マージン不足(要注意)、負値→高マージン(OK)
6. **リスクセンター確認**: `GET /api/projects/:id/risk-centre`
   - critical/high/medium/low のリスクレベル表示
7. **AI条件チェック** (オプション): `POST /api/ai/check-conditions`
   - 47ルールの充足・未充足を自動判定
8. **再計算**: スナップショット再生成で最新マスタ反映
9. **差分解決**: diff画面で手動調整項目を確認・承認

### 2.3 システム設定変更

```bash
# 設定値一覧の取得
curl https://<project-name>.pages.dev/api/master/system-settings

# 設定値の更新 (例: 売価ギャップ警告閾値を12%に)
curl -X PATCH https://<project-name>.pages.dev/api/master/system-settings/sales_gap_warning_threshold \
  -H "Content-Type: application/json" \
  -d '{"setting_value": "12"}'
```

**変更可能な設定 (9項目)**:

| 設定キー | 型 | 説明 | 初期値 |
|---------|-----|------|--------|
| `batch_size_limit` | number | D1バッチサイズ上限 | 100 |
| `default_standard_margin_rate` | number | 標準マージン率(%) | 30 |
| `default_solar_margin_rate` | number | ソーラーマージン率(%) | 20 |
| `default_option_margin_rate` | number | オプションマージン率(%) | 25 |
| `enable_ai_condition_check` | boolean | AI条件チェック有効化 | true |
| `lock_conflict_alert_threshold` | number | ロック競合警告閾値(秒) | 120 |
| `price_expiry_warning_days` | number | 単価有効期限警告(日) | 90 |
| `sales_gap_warning_threshold` | number | 売価ギャップ警告閾値(%) | 10 |
| `sales_gap_error_threshold` | number | 売価ギャップエラー閾値(%) | 20 |

### 2.4 マスタデータ確認

```bash
# カテゴリ一覧 (10カテゴリ)
curl https://<project-name>.pages.dev/api/master/categories

# 工種一覧 (58工種)
curl https://<project-name>.pages.dev/api/master/items

# ルール条件一覧
curl https://<project-name>.pages.dev/api/master/rules
```

### 2.5 AI警告管理

```bash
# プロジェクト別警告一覧
curl https://<project-name>.pages.dev/api/ai/warnings/<project_id>

# 警告ステータス更新 (read/resolve/ignore/reopen)
curl -X PATCH https://<project-name>.pages.dev/api/ai/warnings/<warning_id> \
  -H "Content-Type: application/json" \
  -d '{"action": "resolve", "note": "対応完了"}'
```

---

## 3. 監視項目

### 3.1 定期チェック (推奨: 毎日)

| チェック項目 | エンドポイント | 正常判定基準 |
|-------------|--------------|-------------|
| サービス稼働 | `GET /api/health` | `status: "ok"` |
| AI接続状態 | `GET /api/ai/status` | `ai_available: true` かつ `degradation_mode: "full"` |
| 未解決AI警告数 | `GET /api/ai/warnings/<project_id>` | open_count が急増していないこと |

### 3.2 異常時の対応

| 症状 | 想定原因 | 対応 |
|------|---------|------|
| health が返らない | Workers障害 / デプロイ失敗 | Cloudflareダッシュボードで確認。前バージョンにロールバック |
| `ai_available: false` | APIキー期限切れ / OpenAI障害 | rule_basedモードで自動縮退。キー更新は下記手順 |
| DB接続エラー | D1障害 | Cloudflareステータスページ確認。通常は自動復旧 |
| 500エラー多発 | コードバグ / データ不整合 | pm2 logs確認、前バージョンにロールバック |

---

## 4. デプロイ手順

### 4.1 通常デプロイ

```bash
# 1. ビルド
cd /home/user/webapp && npm run build

# 2. デプロイ
npx wrangler pages deploy dist --project-name hiramatsu-cost

# 3. デプロイ後確認
curl https://hiramatsu-cost.pages.dev/api/health
```

### 4.2 DBマイグレーション付きデプロイ

```bash
# 1. 本番DBにマイグレーション適用 (新テーブル追加時)
npx wrangler d1 migrations apply hiramatsu-cost-production

# 2. ビルド & デプロイ
npm run build && npx wrangler pages deploy dist --project-name hiramatsu-cost

# 3. データ確認
npx wrangler d1 execute hiramatsu-cost-production --command="SELECT COUNT(*) FROM projects"
```

### 4.3 OpenAI APIキー更新

```bash
# Cloudflare Secretsに設定
npx wrangler pages secret put OPENAI_API_KEY --project-name hiramatsu-cost
# プロンプトでAPIキーを入力

# 確認 (キー値は表示されない)
npx wrangler pages secret list --project-name hiramatsu-cost
```

---

## 5. UI操作ガイド

### 5.1 アクセスURL

| 画面 | パス |
|------|------|
| 案件一覧 | `/ui/projects` |
| 案件詳細 (7タブ) | `/ui/projects/:id` |

### 5.2 案件詳細の7タブ

1. **プロジェクト編集** - 案件基本情報のインライン編集 (CR-05)
2. **リスクセンター** - 入力充足率・リスクスコア・アクション要否
3. **原価明細** - 58工種の自動算出結果と手動上書き
4. **差分解決** - 再計算時の変更点確認と承認
5. **原価集計** - カテゴリ別集計・総額
6. **売価見積** - 売価入力 + ギャップ分析ビジュアライゼーション
7. **AI & 警告** - AIステータス・条件チェック・警告CRUD・PDF読取

---

## 6. バックアップ・リストア

### 6.1 D1データベースバックアップ

```bash
# 全テーブルデータエクスポート (主要テーブル)
npx wrangler d1 execute hiramatsu-cost-production \
  --command="SELECT * FROM projects" --json > backup_projects.json

npx wrangler d1 execute hiramatsu-cost-production \
  --command="SELECT * FROM cost_master_items" --json > backup_master_items.json
```

### 6.2 コードバックアップ

```bash
# Git経由
git push origin main

# アーカイブ
tar -czf hiramatsu-cost-backup-$(date +%Y%m%d).tar.gz /home/user/webapp/
```

---

## 7. 連絡先・エスカレーション

| レベル | 状況 | 対応 |
|--------|------|------|
| L1 | UI表示崩れ、軽微なエラー | 次回デプロイで修正 |
| L2 | API 500エラー、AI接続断 | 当日中に調査・ロールバック検討 |
| L3 | DB接続不可、全面停止 | Cloudflareステータス確認 → 即時ロールバック |
