# 運用ランブック（障害対応・運用手順書）

## 1. 概要

本ドキュメントは、概算原価管理システムの運用開始後に発生しうるインシデントと、その予防策・対応手順を定義する。

**対象読者**: システム管理者、開発者
**想定環境**: Cloudflare Pages + Workers + D1

---

## 2. インシデント分類と対応レベル

| レベル | 定義 | 対応SLA | 例 |
|--------|------|---------|-----|
| P1（緊急） | 全ユーザーがシステムを利用できない | 即時対応 | D1接続障害、Workers障害 |
| P2（重大） | 主要機能が利用できない | 2時間以内 | 原価計算エラー、マスタ不整合 |
| P3（通常） | 一部機能に問題がある | 翌営業日 | 特定工種の計算誤差、UI表示崩れ |
| P4（軽微） | 軽微な不具合・改善要望 | 次回リリース | 文言修正、並び順の要望 |

---

## 3. 予防策（インシデント発生前）

### 3-1. D1バックアップ戦略

**自動バックアップ（Cloudflare標準）**:
- D1 Time Travel: 30日間の自動バックアップ（Cloudflare管理）
- 任意時点へのロールバックが可能

**手動バックアップ（週次）**:
```bash
# 毎週月曜朝に実行
wrangler d1 export <database-name> --output=backup_$(date +%Y%m%d).sql

# R2にアップロード
wrangler r2 object put <bucket-name>/backups/backup_$(date +%Y%m%d).sql --file=backup_$(date +%Y%m%d).sql
```

**マスタデータのGit管理**:
- 全シードJSONファイルはGitリポジトリで管理
- マスタ変更のたびにシードファイルを更新してコミット
- いつでもシードから再投入可能な状態を維持

### 3-2. マスタ変更影響チェック

**マスタ単価変更前チェックリスト**:
1. 変更対象のマスタアイテムを確認
2. 影響を受ける進行中案件を検索
3. 影響案件の担当者に事前連絡
4. 変更理由を記録
5. 変更実行後、影響案件に通知バナーが表示されることを確認

**影響案件の検索クエリ**:
```sql
SELECT DISTINCT p.project_code, p.project_name, p.status
FROM project_cost_items pci
JOIN projects p ON pci.project_id = p.id
WHERE pci.master_item_id = '<変更対象のitem_id>'
  AND p.status IN ('draft', 'in_progress', 'reviewed')
ORDER BY p.created_at DESC;
```

### 3-3. 楽観ロック衝突の監視

**監視対象**: 409 Conflict レスポンスの発生頻度
**閾値**: 1時間に5回以上 → 管理者に通知
**対策**: ユーザーへの同時編集回避のガイダンス表示

### 3-4. 単価有効期限の定期チェック

**週次チェック**:
```sql
-- 30日以内に期限切れになるマスタアイテム
SELECT cmi.id, cmi.item_name, cmiv.effective_to,
       JULIANDAY(cmiv.effective_to) - JULIANDAY('now') as days_remaining
FROM cost_master_item_versions cmiv
JOIN cost_master_items cmi ON cmiv.master_item_id = cmi.id
WHERE cmiv.effective_to IS NOT NULL
  AND cmiv.effective_to <= date('now', '+30 days')
  AND cmiv.effective_to > date('now')
ORDER BY cmiv.effective_to;
```

---

## 4. インシデント対応手順

### 4-1. P1: システム全体が利用不能

**症状**: ページが表示されない、APIが応答しない

**確認手順**:
1. Cloudflare Status Page (https://www.cloudflarestatus.com/) を確認
2. `curl https://<project-name>.pages.dev/api/health` でヘルスチェック
3. Cloudflare Dashboard → Workers & Pages → ログを確認

**対応**:
- Cloudflare障害の場合: 復旧を待つ（ユーザーに状況を通知）
- コード障害の場合: 前回のデプロイにロールバック
  ```bash
  # 直前のデプロイを確認
  wrangler pages deployments list --project-name <project-name>
  
  # 特定のデプロイIDにロールバック
  wrangler pages deployments rollback <deployment-id> --project-name <project-name>
  ```

### 4-2. P2: 原価計算結果がスプレッドシートと不一致

**症状**: 特定の案件で計算結果がスプレッドシートと異なる

**確認手順**:
1. 案件の基本条件（ラインナップ、坪数、面積等）を確認
2. 該当工種の `project_cost_items` を確認
3. 適用されたルールを確認（`project_audit_logs` から `action=calculate`）
4. マスタの単価・ルールが正しいか確認

**差異分析クエリ**:
```sql
-- 案件の明細一覧（自動計算値と最終値を比較）
SELECT pci.item_name, pci.auto_quantity, pci.auto_unit_price, pci.auto_amount,
       pci.manual_quantity, pci.manual_unit_price, pci.manual_amount,
       pci.final_quantity, pci.final_unit_price, pci.final_amount,
       pci.calculation_type, pci.is_selected
FROM project_cost_items pci
WHERE pci.project_id = <project_id>
  AND pci.category_code = '<category_code>'
ORDER BY pci.sort_order;
```

**対応**:
- マスタデータの誤り → マスタ修正 + 影響案件の再計算
- ルールの誤り → ルール修正 + 影響案件の再計算
- 計算ロジックのバグ → コード修正 + テスト + 再デプロイ

### 4-3. P2: マスタデータの不整合

**症状**: ルールが参照するアイテムが存在しない、バージョンが欠落

**確認手順**:
```sql
-- 参照先が存在しないルール
SELECT crc.id, crc.master_item_id
FROM cost_rule_conditions crc
LEFT JOIN cost_master_items cmi ON crc.master_item_id = cmi.id
WHERE cmi.id IS NULL;

-- バージョンが存在しないアイテム
SELECT cmi.id, cmi.item_name
FROM cost_master_items cmi
LEFT JOIN cost_master_item_versions cmiv ON cmi.id = cmiv.master_item_id
WHERE cmiv.id IS NULL;
```

**対応**:
1. 不整合の原因を特定（手動操作ミス、マイグレーション漏れ等）
2. シードファイルから正しいデータを復旧
3. 影響案件があれば再計算

### 4-4. P3: 同時編集による楽観ロック衝突

**症状**: ユーザーが「データが更新されています。画面をリロードしてください」と表示される

**対応**:
- ユーザーに画面リロードを案内
- 頻発する場合は編集対象の案件を一時的に1名にアサイン
- 根本対策: 工種単位のロックではなく明細単位のロックに粒度変更（Phase 2）

### 4-5. P2: D1トランザクションタイムアウト

**症状**: 大規模案件の原価計算が途中で失敗

**確認手順**:
1. Workers のログで実行時間を確認
2. 案件の明細数を確認（通常50-100件、異常時は200件超）

**対応**:
1. 計算対象を工種グループごとに分割して実行
2. D1バッチ制限（100件）を超えている場合、分割ロジックを確認
3. ワーカーのCPU時間制限に近い場合、計算ロジックの最適化

---

## 5. 定期運用タスク

### 日次
| タスク | 実行方法 | 目的 |
|--------|---------|------|
| ヘルスチェック | 自動（Cloudflare） | システム稼働確認 |
| エラーログ確認 | Workers ダッシュボード | 異常検知 |

### 週次
| タスク | 実行方法 | 目的 |
|--------|---------|------|
| D1手動バックアップ | wrangler d1 export | データ保全 |
| 単価有効期限チェック | SQLクエリ実行 | 期限切れ防止 |
| 楽観ロック衝突回数確認 | ログ分析 | 同時編集問題の早期発見 |

### 月次
| タスク | 実行方法 | 目的 |
|--------|---------|------|
| project_warnings 肥大化チェック | SQLクエリ | テーブルサイズ管理 |
| 未使用マスタアイテムの確認 | SQLクエリ | データ品質維持 |
| シードファイルとDB内容の差分確認 | 手動比較 | Git管理との整合性 |

### 半期
| タスク | 実行方法 | 目的 |
|--------|---------|------|
| 全マスタデータのレビュー | 平松建築担当者と | 単価の妥当性確認 |
| テスト案件の再検証 | 3パターンのシミュレーション | 計算精度の維持確認 |

---

## 6. リカバリ手順

### 6-1. マスタデータの全復旧

```bash
# 1. 現在のDBを退避
wrangler d1 export <database-name> --output=pre_recovery_$(date +%Y%m%d).sql

# 2. マスタテーブルのデータをクリア（案件データは残す）
wrangler d1 execute <database-name> --command="DELETE FROM cost_rule_conditions"
wrangler d1 execute <database-name> --command="DELETE FROM cost_master_item_versions"
wrangler d1 execute <database-name> --command="DELETE FROM cost_master_items"
wrangler d1 execute <database-name> --command="DELETE FROM cost_categories"

# 3. シードファイルから再投入
# （JSON→SQL変換スクリプトを実行）
wrangler d1 execute <database-name> --file=seeds/categories.sql
wrangler d1 execute <database-name> --file=seeds/items.sql
wrangler d1 execute <database-name> --file=seeds/versions.sql
wrangler d1 execute <database-name> --file=seeds/rules.sql

# 4. 検証クエリを実行
wrangler d1 execute <database-name> --command="SELECT COUNT(*) FROM cost_categories"
```

### 6-2. D1 Time Travel によるロールバック

```bash
# 利用可能なブックマークを確認
wrangler d1 time-travel info <database-name>

# 特定時点にリストア
wrangler d1 time-travel restore <database-name> --timestamp=<ISO-8601-timestamp>
```

### 6-3. 案件データの部分復旧

特定案件の原価明細が破損した場合:
```sql
-- 1. 該当案件の明細を削除
DELETE FROM project_cost_items WHERE project_id = <project_id>;
DELETE FROM project_cost_summaries WHERE project_id = <project_id>;
DELETE FROM project_warnings WHERE project_id = <project_id>;

-- 2. 原価再計算APIを実行
-- POST /api/projects/<project_id>/calculate
```

---

## 7. エスカレーションフロー

```
ユーザー報告
    ↓
管理者（社内） → P3/P4 対応
    ↓ P1/P2
開発チーム → コード修正・データ復旧
    ↓ Cloudflare障害
Cloudflare サポート → インフラ復旧
```

---

*最終更新: 2026-03-07*
*作成者: システム設計フェーズ*
