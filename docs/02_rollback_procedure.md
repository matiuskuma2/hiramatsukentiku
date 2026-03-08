# 平松建築 概算原価管理システム - 障害時切り戻し手順書

**バージョン**: 0.8.0-step8  
**更新日**: 2026-03-08  
**対象者**: システム管理者

---

## 1. ロールバック方針

### 1.1 基本原則

- **コード (Workers)** → Cloudflare Pages のデプロイ履歴から即時ロールバック可能
- **データベース (D1)** → マイグレーションは原則として前方互換。破壊的変更はバックアップ必須
- **シークレット (Secrets)** → wrangler CLI で上書き更新

### 1.2 ロールバック判断基準

| 状況 | ロールバック要否 | 手法 |
|------|----------------|------|
| デプロイ後にUI表示崩れ | 要 | コードロールバック |
| デプロイ後にAPI 500エラー多発 | 要 | コードロールバック |
| マイグレーション後にDBエラー | 要 | DB + コードロールバック |
| AI機能のみ停止 | 不要 | rule-basedフォールバックが自動作動 |
| Cloudflare基盤障害 | 不要 | 自動復旧を待つ (status.cloudflare.com 確認) |

---

## 2. コードロールバック手順

### 2.1 Cloudflare Dashboardからのロールバック (推奨)

1. [Cloudflare Dashboard](https://dash.cloudflare.com) にログイン
2. Workers & Pages → `hiramatsu-cost` プロジェクトを選択
3. **Deployments** タブを開く
4. 正常動作が確認されていたデプロイを見つける
5. 「...」メニュー → **Rollback to this deployment** を選択
6. 確認後、即座にロールバック完了 (数秒)

### 2.2 CLIからのロールバック

```bash
# 1. デプロイ履歴を確認
npx wrangler pages deployments list --project-name hiramatsu-cost

# 2. 前バージョンのコードをGitから復元
git log --oneline -5
git checkout <commit-hash> -- src/
# または
git revert HEAD

# 3. 再ビルド & 再デプロイ
npm run build
npx wrangler pages deploy dist --project-name hiramatsu-cost

# 4. 確認
curl https://hiramatsu-cost.pages.dev/api/health
```

### 2.3 Git タグベースのロールバック

```bash
# タグ付け運用の場合
git tag v0.8.0-step8  # デプロイ時にタグ付け

# ロールバック
git checkout v0.7.0-step7
npm run build
npx wrangler pages deploy dist --project-name hiramatsu-cost
git checkout main
```

---

## 3. データベースロールバック手順

### 3.1 マイグレーション前の注意事項

**デプロイ前チェックリスト**:
- [ ] 新マイグレーションに `IF NOT EXISTS` / `IF EXISTS` が含まれていること
- [ ] `DROP TABLE` や `DROP COLUMN` が含まれていないこと (D1は ALTER TABLE DROP COLUMN 非対応)
- [ ] 本番DBのバックアップを取得済み

### 3.2 バックアップ取得

```bash
# デプロイ前に主要テーブルをバックアップ
TABLES="projects cost_master_items cost_categories project_cost_items project_cost_snapshots project_cost_summaries project_sales_estimates project_warnings system_settings app_users cost_snapshot_jobs project_cost_regeneration_diffs"

for TABLE in $TABLES; do
  npx wrangler d1 execute hiramatsu-cost-production \
    --command="SELECT * FROM $TABLE" --json > "backup_${TABLE}_$(date +%Y%m%d).json"
  echo "Backed up: $TABLE"
done
```

### 3.3 D1マイグレーション取り消し

D1にはネイティブの `migrate down` がないため、**逆マイグレーション SQL** を手動で作成・実行する。

**現在のマイグレーション一覧と逆操作**:

| # | ファイル | 内容 | 逆操作 |
|---|---------|------|--------|
| 0001 | `initial_schema.sql` | 23テーブル + インデックス + シード | DROP TABLE (※全データ消失注意) |
| 0002 | `cr01_cr02_tables_and_columns.sql` | 追加カラム・テーブル | ALTER TABLE DROP 不可 → 再作成が必要 |
| 0003 | `warnings_source_status.sql` | 警告テーブル拡張 | カラム削除不可 → 無視して運用 |
| 0004 | `diff_resolution_columns.sql` | 差分解決カラム追加 | カラム削除不可 → 無視して運用 |
| 0005 | `ai_warnings_read_status.sql` | AI警告既読ステータス | カラム削除不可 → 無視して運用 |

**実行例 (0005のロールバック)**:
```bash
# 0005 で追加されたカラムは「存在するが使わない」が最も安全
# コード側でカラム参照を外す → 再デプロイで対応
```

### 3.4 データ復旧

```bash
# バックアップJSONからリストア (例: projects)
# 1. バックアップファイルからINSERT文を生成
cat backup_projects_20260308.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for row in data:
    cols = ', '.join(row.keys())
    vals = ', '.join([repr(v) if isinstance(v, str) else str(v) for v in row.values()])
    print(f'INSERT OR REPLACE INTO projects ({cols}) VALUES ({vals});')
" > restore_projects.sql

# 2. 本番DBに適用
npx wrangler d1 execute hiramatsu-cost-production --file=./restore_projects.sql
```

---

## 4. シークレット復旧

```bash
# APIキーの再設定
npx wrangler pages secret put OPENAI_API_KEY --project-name hiramatsu-cost
npx wrangler pages secret put DEV_USER_EMAIL --project-name hiramatsu-cost

# 設定確認 (値は表示されない)
npx wrangler pages secret list --project-name hiramatsu-cost
```

---

## 5. 緊急対応フローチャート

```
障害発生
  │
  ├─ API応答なし？
  │   ├─ YES → Cloudflareステータス確認
  │   │         ├─ 基盤障害 → 復旧待ち
  │   │         └─ 正常 → コードロールバック (2.1)
  │   └─ NO → 次へ
  │
  ├─ 500エラー多発？
  │   ├─ YES → pm2 logs確認 → コードロールバック (2.1/2.2)
  │   └─ NO → 次へ
  │
  ├─ DB関連エラー？
  │   ├─ YES → バックアップ確認 → DB復旧 (3.4) + コードロールバック
  │   └─ NO → 次へ
  │
  ├─ AI機能のみ停止？
  │   ├─ YES → rule-basedフォールバック作動中。APIキー確認 (4)
  │   └─ NO → 次へ
  │
  └─ その他 → ログ調査 → 開発者にエスカレーション
```

---

## 6. ロールバック後の確認チェックリスト

- [ ] `GET /api/health` → `status: "ok"` 返却
- [ ] `GET /api/ai/status` → 正常応答
- [ ] `GET /ui/projects` → 案件一覧表示
- [ ] `GET /ui/projects/<既存ID>` → 案件詳細7タブ表示
- [ ] `GET /api/master/categories` → 10カテゴリ返却
- [ ] `GET /api/master/items` → 58工種返却
- [ ] `GET /api/master/system-settings` → 9設定返却
- [ ] `PATCH /api/master/system-settings/<key>` → 更新成功
- [ ] `POST /api/projects/<ID>/snapshots` → スナップショット生成成功
- [ ] 売価見積 → ギャップ分析動作確認

---

## 7. 予防策

1. **デプロイ前に必ずM8テスト実行** (フルフローE2E)
2. **Gitタグでバージョン管理** (`git tag vX.Y.Z-stepN`)
3. **マイグレーションは前方互換のみ** (ADD COLUMN / CREATE TABLE のみ)
4. **本番デプロイ前にバックアップ取得**
5. **段階デプロイ**: ステージング → 本番 (Cloudflare Pages プレビューURL活用)
