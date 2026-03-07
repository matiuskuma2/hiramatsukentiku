# 横断クロスレビュー＆解決方針書

## 1. 本ドキュメントの目的

全設計ドキュメント（00〜06）と4つのシードJSONファイルを横断的にレビューし、以下を整理する：

1. **矛盾・不整合**（Critical） → 放置するとデータ不整合や計算エラーに直結
2. **技術負債・設計リスク**（High） → 実装前に方針を明確化しないと手戻りが発生
3. **不明点・要確認事項**（Medium） → ヒアリングまたは仕様決定が必要
4. **運用インシデントリスク**（Medium-High） → 本番運用開始後にトラブルになりうる
5. **シードファイル固有の問題** → JSONとDBスキーマの不整合

**重要：本フェーズでは設計・計画の改善のみを行い、コード実装は一切行わない。**

---

## 2. 矛盾・不整合（Critical）

### C-01: 工種数の不一致（35 vs 37）

| 箇所 | 記述 |
|------|------|
| 00_PROJECT_OVERVIEW.md 4-1節 | 「10パターンが混在」（工種数への直接言及なし） |
| 01_DB_SCHEMA_DESIGN.md テーブル一覧 | 「約35件（固定）」 |
| 02_COST_CALCULATION_DEFINITIONS.md | 「全35工種＋2カテゴリ（太陽光・オプション）」 |
| 03_SCREEN_DESIGN.md サマリー画面 | 「全35工種中」 |
| 05_MASTER_DATA_PLAN.md Step 1 | 37工種のINSERT文が存在 |

**問題**: 太陽光・オプションを「工種」に含めるかで数字が揺れている。

**解決方針**: **37工種を正式な数値として全ドキュメントで統一する。**
- `cost_categories` テーブルに37レコード（太陽光・オプション含む）
- UIの表示では「標準工事35工種 + 太陽光 + オプション = 合計37工種」のように区分表示
- 03_SCREEN_DESIGN.md の「全35工種中」を「全37工種中」に修正

---

### C-02: 計算方式の数が不一致（10 vs 11）

| 箇所 | 記述 |
|------|------|
| 00_PROJECT_OVERVIEW.md 4-1節 | 「10パターン」（テーブルは11行） |
| 02_COST_CALCULATION_DEFINITIONS.md | 11コード一覧（threshold_surcharge含む） |
| 01_DB_SCHEMA_DESIGN.md cost_master_items | コメントに10個のみ列挙 |

**問題**: `threshold_surcharge` が一部ドキュメントから脱落。

**解決方針**: **11パターンを正式とする。**
加えて、シードファイルで発見された `per_piece`（通線口、養生テープ）と `per_meter`（深基礎、幕板）を明示的に含め、合計**12パターン**として整理する：

| # | コード | 説明 | 代表例 |
|---|--------|------|--------|
| 1 | `fixed_amount` | 固定額 | レッカー、地盤保証 |
| 2 | `per_tsubo` | 坪単価 × 坪数 | 金物、電気設備、現場管理費 |
| 3 | `per_m2` | 面積単価 × 面積 | 断熱材、屋根本体、美装 |
| 4 | `per_meter` | メートル単価 × 長さ | 深基礎、幕板、軒樋 |
| 5 | `per_piece` | 個数単価 × 個数 | 通線口、養生テープ |
| 6 | `range_lookup` | 範囲帯ルックアップ | 基礎面積帯、瑕疵担保保険 |
| 7 | `lineup_fixed` | ラインナップ別固定額 | 木工事MOKU系 |
| 8 | `rule_lookup` | ルール表で数量算出 | WB部材、大工人工、断熱等級切替 |
| 9 | `manual_quote` | 都度見積／手入力 | 土工事、残土処分 |
| 10 | `product_selection` | 商品選択＋数量入力 | サッシ、太陽光 |
| 11 | `package_with_delta` | 標準セット＋差額管理 | 産廃ボックス |
| 12 | `threshold_surcharge` | しきい値超過時加算 | 水道70m超 |

---

### C-03: シードJSON の category_code vs DB の FK 設計

| 箇所 | 構造 |
|------|------|
| seed_categories_priority_a.json | `id: "cat_foundation"`, `category_code: "foundation"` (文字列ID) |
| seed_items_priority_a.json | `category_code: "foundation"` (category_codeで参照) |
| 01_DB_SCHEMA_DESIGN.md cost_master_items | `category_id INTEGER` (数値FK) |

**問題**: シードファイルは `category_code`（文字列）で工種を参照しているが、DBスキーマは `category_id`（整数FK）で参照。シードファイルのID体系（`cat_foundation`, `item_foundation_lt60`等）は文字列であり、DBの `INTEGER PRIMARY KEY AUTOINCREMENT` と互換性がない。

**解決方針**:
1. **DBスキーマ側を修正**: `cost_master_items.category_id` に加えて `category_code TEXT` カラムを持つ（またはVIEWで解決）
2. **推奨案**: シードファイルの文字列IDをそのまま使えるよう、`cost_categories` と `cost_master_items` のPKを `TEXT PRIMARY KEY` に変更する。AUTOINCREMENT は不要（マスタデータは事前定義されるため）
3. **移行時**: JSON → SQL変換スクリプトで `category_code` → `category_id` のマッピングを行う

**決定事項**: マスタ系テーブル（cost_categories, cost_master_items, cost_rule_conditions）は `TEXT PRIMARY KEY` を採用し、シードファイルのID体系をそのまま使用する。案件系テーブル（projects, project_cost_items等）は `INTEGER PRIMARY KEY AUTOINCREMENT` を維持する。

---

### C-04: シードJSON `item_versions` テーブルがDBスキーマに存在しない

| 箇所 | 内容 |
|------|------|
| seed_item_versions_priority_a.json | `master_item_id`, `version_no`, `effective_from`, `effective_to` 等のバージョン管理フィールド |
| 01_DB_SCHEMA_DESIGN.md | `cost_master_items` に `valid_from`, `valid_to` はあるがバージョンテーブルなし |

**問題**: シードファイルは明細マスタのバージョン管理を独立テーブルで行う前提だが、DBスキーマにはそのテーブルが存在しない。

**解決方針**: **`cost_master_item_versions` テーブルを新設する。**
- 明細マスタの単価変更履歴を正式に管理するテーブル
- `cost_master_items` は「現在有効なバージョン」のサマリー、`cost_master_item_versions` は「全履歴」
- スナップショット時には `cost_master_item_versions.id` を `project_cost_items` に記録
- これにより「どの時点のどのバージョンの単価でスナップショットしたか」が追跡可能

```
cost_master_item_versions
  id TEXT PRIMARY KEY          -- ver_item_foundation_lt60_v1
  master_item_id TEXT NOT NULL -- item_foundation_lt60
  version_no INTEGER NOT NULL
  unit TEXT
  calculation_type TEXT
  unit_price REAL
  fixed_amount REAL
  quantity_reference_field TEXT
  vendor_name TEXT
  note TEXT
  calculation_basis_note TEXT
  rule_json TEXT               -- バージョン固有のルール設定
  effective_from TEXT NOT NULL
  effective_to TEXT             -- NULLなら現在有効
  change_reason TEXT
  changed_by TEXT
  created_at TEXT DEFAULT (datetime('now'))
```

---

### C-05: `per_piece` が計算方式一覧に未定義

| 箇所 | 内容 |
|------|------|
| seed_items_priority_a.json | `item_elec_tsusen` (通線口) と `item_clean_tape` (養生テープ) が `calculation_type: "per_piece"` |
| 02_COST_CALCULATION_DEFINITIONS.md | `per_piece` が計算方式コード一覧に存在しない |

**問題**: シードデータに存在する計算タイプがドキュメントで定義されていない。

**解決方針**: C-02 の解決に含める。`per_piece` を正式な計算方式として追加。ロジックは `per_meter` や `per_m2` と同じ（数量 × 単価）だが、UIの単位表示と数量入力の粒度が異なる。

---

### C-06: `unit_price` vs `fixed_amount` のセマンティクスの混乱

| 箇所 | 問題 |
|------|------|
| seed_items_priority_a.json | `current_unit_price` と `current_fixed_amount` が排他的に使われている（一方がnull） |
| seed_item_versions_priority_a.json | `unit_price` と `fixed_amount` が同様に排他的 |
| 01_DB_SCHEMA_DESIGN.md cost_master_items | `base_unit_price` のみ（`fixed_amount` カラムなし） |
| seed: item_panel_shipping | `current_unit_price: 30000` で `calculation_type: "fixed_amount"` → unit_priceに値があるがfixed_amountはnull |
| rule: rule_panel_shipping | `set_fixed_amount: 60000` → ルールで30000×2=60000をセット |

**問題**: 
1. DBスキーマに `fixed_amount` カラムがない
2. シードでは `unit_price` と `fixed_amount` を使い分けているが、その切り分けルールが不明確
3. `per_tsubo` の場合は `unit_price` に坪単価、`fixed_amount` はnull → 明確
4. `fixed_amount` の場合は `current_fixed_amount` に金額 → だが `panel_shipping` は `unit_price` に入っている

**解決方針**: 
1. `cost_master_items` に `base_fixed_amount REAL` カラムを追加
2. セマンティクスを明確化:
   - `base_unit_price`: 単価（数量 × 単価 で金額を算出する場合に使用）
   - `base_fixed_amount`: 固定額（数量によらず一定額の場合に使用）
3. `calculation_type` ごとにどちらを使うかを明文化:
   - `fixed_amount` → `base_fixed_amount` を使用
   - `per_tsubo`, `per_m2`, `per_meter`, `per_piece` → `base_unit_price` を使用
   - `lineup_fixed` → `base_fixed_amount` を使用
   - `range_lookup` → 面積帯による選択なので `base_unit_price` または `base_fixed_amount`
   - `rule_lookup` → ルール結果に依存
   - `package_with_delta` → `base_unit_price` を使用（数量 × 単価）

---

### C-07: `cost_rule_conditions` のスキーマ vs シードJSONの構造差異

| 箇所 | 構造 |
|------|------|
| 01_DB_SCHEMA_DESIGN.md | `condition_field`, `operator`, `condition_value` (1行1条件) |
| seed_rules_priority_a.json | `conditions: [{ field, operator, value }, ...]` (1ルール内に複数条件をJSON配列で保持) |
| DB の operator | `eq / ne / gt / gte / lt / lte / in / not_in / between` |
| シードの operator | `= / >= / < / in` |

**問題**: 
1. DBは1行1条件（AND条件は `rule_group` で結合）だが、シードは1レコード内に複数条件をJSON配列で保持
2. 演算子の記法が異なる（`eq` vs `=`）
3. シードの `actions` 配列（1ルールに複数アクション）もDB構造と不一致

**解決方針**: **DBスキーマをシードファイルの構造に合わせて修正する。**

新しい `cost_rule_conditions` 設計:
```
cost_rule_conditions
  id TEXT PRIMARY KEY
  master_item_id TEXT NOT NULL     -- 対象明細ID
  rule_group TEXT NOT NULL         -- selection / calculation / warning
  rule_name TEXT                   -- 人間可読名
  priority INTEGER DEFAULT 100
  conditions_json TEXT NOT NULL    -- JSON配列: [{field, operator, value}, ...]
  actions_json TEXT NOT NULL       -- JSON配列: [{type, value}, ...]
  is_active INTEGER DEFAULT 1
  valid_from TEXT
  valid_to TEXT
  created_at TEXT DEFAULT (datetime('now'))
```

演算子は `= / != / > / >= / < / <= / in / not_in / between` に統一（シード側の記法を採用）。

---

### C-08: `gross_margin_group` vs `margin_group` のフィールド名不一致

| 箇所 | フィールド名 |
|------|-------------|
| seed_categories_priority_a.json | `gross_margin_group` |
| 01_DB_SCHEMA_DESIGN.md cost_categories | `margin_group` |

**解決方針**: `gross_margin_group` に統一する（シード側を採用。より明確な命名）。

---

### C-09: `roofing` vs `roof` のカテゴリコード不一致

| 箇所 | コード |
|------|--------|
| 01_DB_SCHEMA_DESIGN.md, 02_COST_CALCULATION_DEFINITIONS.md | `roofing` |
| seed_categories_priority_a.json | `roof` |

**問題**: 同じ「屋根工事」が2つの異なるコードで参照されている。

**解決方針**: **`roof` に統一する。** シードファイルの命名が簡潔で一貫性がある。同様に他のカテゴリコードも確認・統一する。

確認が必要なコード対照:
| ドキュメント | シード | 統一案 |
|-------------|--------|--------|
| roofing | roof | `roof` |
| electrical | electrical_facility | `electrical_facility` |
| waste_disposal | waste_box | `waste_box` |
| external_audit | (未提出) | `external_audit` |
| defect_insurance | defect_insurance | `defect_insurance` (一致) |

---

### C-10: 瑕疵担保保険の面積帯データが不完全

| 箇所 | 記述 |
|------|------|
| 02_COST_CALCULATION_DEFINITIONS.md | 100m2超の保険料・検査料が「要確認」 |
| seed_items_priority_a.json | 全面積帯の金額が明示されている（100-125, 125-150, 150+） |

**問題**: ドキュメント上は「要確認」だが、シードファイルでは具体的金額が入っている。

**解決方針**: **シードファイルの金額を正式データとして採用し、ドキュメントを更新する。**

| 面積帯 | 保険料 | 検査料 |
|--------|--------|--------|
| 〜100m2未満 | 27,290 | 11,000 |
| 100〜125m2未満 | 28,270 | 12,580 |
| 125〜150m2未満 | 32,110 | 17,580 |
| 150m2以上 | 44,740 | 22,580 |

---

## 3. 技術負債・設計リスク（High）

### T-01: `final_quantity / final_unit_price / final_amount` の算出ロジック未定義

**問題**: `project_cost_items` に `auto_*`、`manual_*`、`final_*` の3系統があるが、`final_*` がどのように決まるかが明文化されていない。

**解決方針**: 以下のルールを明文化する:

```
final_quantity = manual_quantity ?? auto_quantity
final_unit_price = manual_unit_price ?? auto_unit_price
final_amount = 
  CASE
    WHEN manual_amount IS NOT NULL THEN manual_amount
    WHEN manual_quantity IS NOT NULL OR manual_unit_price IS NOT NULL
      THEN final_quantity * final_unit_price
    ELSE auto_amount
  END
```

**制約**: `manual_*` に値がある場合は `override_reason` が必須（NOT NULLチェック）。

---

### T-02: 再計算時の手修正保持ルール未定義

**問題**: 案件の基本情報（坪数、ラインナップ等）を変更して再計算した場合、既存の `manual_*` 値をどう扱うかが未定義。

**解決方針**: 以下の3段階ルールを策定:

| 変更種別 | 手修正の扱い | 理由 |
|---------|-------------|------|
| 面積変更のみ（坪数、m2等） | 手修正を保持し、auto_* のみ再計算 | 単価は変わらず数量のみ変化。手修正意図は有効 |
| ラインナップ変更 | 手修正をクリアし、全面再計算 | 工種の構成自体が変わるため |
| 断熱等級変更 | 該当工種（断熱材、真壁パネル）の手修正のみクリア | 影響範囲が限定的 |

**UIフロー**: 再計算前に「既存の手修正 N件がクリアされます。続行しますか？」の確認ダイアログを表示。クリアされた手修正は `project_audit_logs` に記録。

---

### T-03: ルール衝突（同一priority同一item）時の解決ポリシー未定義

**問題**: `cost_rule_conditions` で同じ `master_item_id` に同じ `priority` のルールが複数該当した場合の挙動が未定義。シードデータでは大半のルールが `priority: 100` で、同一アイテムの坪数帯ルール（例: `rule_carpentry_shin_rin_lt30` と `rule_carpentry_shin_rin_30_40`）は条件が排他的だが、保証はない。

**解決方針**:
1. **排他的条件群の保証**: 同一 `master_item_id` の `selection` グループルールは、条件が排他的であることを投入時に検証する
2. **衝突時のフォールバック**: 万一複数ルールが同時にヒットした場合:
   - `priority` が高い方を優先
   - 同一priorityの場合は `id` の辞書順で先のルールを優先
   - 衝突が発生したことを `project_warnings` に記録
3. **ルール投入時のバリデーション**: 同一アイテム×同一ルールグループ内で条件がオーバーラップしていないか検証するAPIを提供

---

### T-04: `lineup_packages` と `cost_master_items` の二重管理

**問題**: 木工事MOKU系の固定額は `cost_master_items`（`lineup_fixed`タイプ）にも `lineup_packages` テーブルにも格納される。SSoT（Single Source of Truth）が不明確。

**解決方針**: **`cost_master_items` をSSoTとする。**
- `lineup_packages` テーブルは Phase 1 では使用しない（将来のパッケージ管理用に予約）
- `lineup_fixed` タイプの明細マスタと、`rule_lookup` のルールで自動選択を実現
- シードファイルの構造（`cost_master_items` + `cost_rule_conditions`）がすでにこの方針に沿っている
- `lineup_packages` は Phase 2 以降、住宅設備パック等の複合パッケージ管理で活用

---

### T-05: D1 バッチ制限（100 SQL文）への対策

**問題**: Cloudflare D1 の batch API は1回あたり100 SQL文の制限がある。案件作成時の原価自動計算で、全37工種×平均5明細 = 約185件のINSERTが必要。

**解決方針**:
1. **バッチ分割**: 100件ずつに分割してバッチ実行
2. **トランザクション保証**: D1のトランザクション内で分割バッチを連続実行
3. **計算エンジンの実装方針**: 
   ```
   1. 全計算結果をメモリ上で組み立て
   2. INSERT文の配列を構築
   3. 100件ずつに分割
   4. D1 transaction 内で順次 batch 実行
   ```
4. **フォールバック**: 個別INSERT（遅いが確実）への切り替え機構

---

### T-06: JSONカラムの検索性とパフォーマンス懸念

**問題**: `conditions_json`, `actions_json`, `rule_json`, `snapshot_json` 等のJSONカラムはSQLiteのJSONサポートに依存。検索やフィルタリングの性能が読めない。

**解決方針**:
1. **JSONカラムの用途を限定**: 検索条件には使わない。表示・復元用途に限定
2. **検索が必要なフィールドは正規カラムとして切り出す**: 例えば `conditions_json` 内の `field` を検索する必要があれば `condition_field` カラムを別途持つ
3. **D1のJSONサポート確認**: `json_extract()` 関数のパフォーマンスを開発環境で検証
4. **Phase 1の想定データ量**: ルール100件、明細500件程度ならJSONパースのオーバーヘッドは無視できる

---

### T-07: スプレッドシート5フィールドの完全保持

要件：「項目名、現行金額、備考、発注先、算出根拠」を完全保持すること。

**マッピング確認**:

| スプレッドシート | cost_master_items カラム | seed_items JSON フィールド | 状態 |
|----------------|------------------------|--------------------------|------|
| 項目名 | `item_name` | `item_name` | OK |
| 現行金額（単価） | `base_unit_price` / `base_fixed_amount` | `current_unit_price` / `current_fixed_amount` | C-06で対応済み |
| 備考 | `note` | `note` | OK |
| 発注先 | `vendor_name` | `vendor_name` | OK |
| 算出根拠 | `calculation_basis` | `calculation_basis_note` | **名前不一致** → 統一必要 |

**解決方針**: DBカラム名を `calculation_basis_note` に統一（シード側を採用。より明確）。

---

### T-08: シードデータの `source_*` フィールドのDB格納先なし

**問題**: `seed_items_priority_a.json` に `source_sheet_name`, `source_file_name`, `source_row_no`, `source_raw_json` があるが、`cost_master_items` テーブルにこれらのカラムがない。

**解決方針**: 
1. `cost_master_items` に以下を追加:
   - `source_sheet_name TEXT` -- 元スプレッドシートのシート名
   - `source_file_name TEXT` -- 元ファイル名
   - `source_row_no INTEGER` -- 元の行番号
   - `source_raw_json TEXT` -- 元データのJSON
2. これらはデータ品質のトレーサビリティ確保のため。UI表示は不要だが、デバッグ・検証時に必須

---

## 4. 不明点・要確認事項（Medium）

### U-01: 認証方式と `users` テーブルの整合性

**現状**: `users` テーブルにはパスワードハッシュカラムがない。Cloudflare Access利用が前提か？
**決定必要事項**: 
- Cloudflare Access → `users` テーブルは参照用（メールで紐付け）
- 自前パスワード認証 → `password_hash TEXT NOT NULL` カラムが必要
- **推奨**: Phase 1 は Cloudflare Access（Zero Trust）で認証。`users` テーブルはアクセスしたメールアドレスから自動作成。

---

### U-02: 基礎工事の参照面積（未解決）

**現状**: ドキュメントでは `building_area_m2 or total_floor_area_m2` と記載。シードファイルでは `quantity_reference_field: "building_area_m2"` と明確。

**解決方針**: **シードファイルの `building_area_m2`（建築面積）を採用。** ドキュメントを修正。

---

### U-03: 概算/詳細モード切替の粒度

**現状**: 00_PROJECT_OVERVIEW.md で「概算モードの考え方を残す」と記載あるが、DBやAPIに概算/詳細を切り替えるフラグがない。

**解決方針**: Phase 1 は概算モードのみ。`project_phase_estimates.phase_type` = `internal_estimate` 固定。Phase 2 で `detailed_estimate` を追加するときにモード切替を実装。

---

### U-04: APIのページネーション・フィルタ仕様

**現状**: API設計にページネーション・ソート・フィルタの仕様がない。

**解決方針**: 以下を標準仕様として全一覧APIに適用:
```
クエリパラメータ:
  ?page=1&per_page=50     -- ページネーション
  ?sort=created_at&order=desc -- ソート
  ?status=in_progress     -- フィルタ（カラム名=値）
  ?search=佐藤           -- テキスト検索

レスポンス:
{
  "data": [...],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total": 120,
    "total_pages": 3
  }
}
```

---

### U-05: 工種間連動の実装位置

**現状**: 外壁→木工事の焼杉連動等が記載されているが、計算エンジンのどの段階で処理するか未定義。

**解決方針**: 計算エンジンを2パスで実行:
1. **第1パス**: 各工種を独立に計算（条件ルール適用、数量算出、金額計算）
2. **第2パス**: 工種間連動ルールを適用
   - 外壁で焼杉採用 → 木工事に `item_carpentry_yakisugi` を自動採用
   - ラインナップ → 複数工種の切替（第1パスで既に処理済み）
   - 建築地 → 産廃・美装のエリア判定（第1パスで既に処理済み）

**連動ルールテーブル案**（Phase 1 では `cost_rule_conditions` にフラグで管理）:
- `rule_group = "cross_category"` で工種間連動ルールを識別

---

### U-06: R2ファイルアップロード/ダウンロード設計

**現状**: `project_cost_items.evidence_file_key` でR2ファイル参照があるが、アップロードAPI・署名URL・ファイルサイズ制限等が未定義。

**解決方針**: Phase 1 では最小限の実装:
- `POST /api/files/upload` → R2にアップロード、キーを返す
- `GET /api/files/:key` → 署名付きURLを返す（直接ダウンロード）
- ファイルサイズ制限: 10MB
- 対象: PDF（見積書・根拠資料）、画像（現場写真）
- 詳細はPhase 2のAI PDF読取で拡張

---

## 5. 運用インシデントリスク（Medium-High）

### O-01: マスタ単価変更時の影響通知手段未定義

**リスク**: マスタ単価を変更しても、進行中案件の担当者に通知がない。旧単価で進行し続ける案件が発生。

**対策**:
1. **マスタ変更時**: `master_change_logs` に記録し、変更影響範囲を自動計算
2. **影響算出クエリ**: 変更された `master_item_id` を使用中の進行中案件を一覧
3. **ダッシュボードに通知バナー**: 「マスタ単価が更新されました。影響案件: N件」
4. **案件詳細に注意表示**: 「この案件のスナップショット単価は最新マスタと異なります」
5. **一括再計算は手動操作**: 「最新マスタで再計算」ボタンを提供（T-02の手修正保持ルール適用）

---

### O-02: 同時編集時の排他制御なし

**リスク**: 複数ユーザーが同じ案件の同じ工種を同時に編集した場合、後勝ちでデータが上書きされる。

**対策**: **楽観的ロック（Optimistic Locking）を採用**
1. `project_cost_items` と `project_cost_summaries` に `version INTEGER DEFAULT 1` カラムを追加
2. 更新時: `UPDATE ... WHERE id = ? AND version = ? SET version = version + 1`
3. 影響行数0の場合 → 409 Conflict を返し、画面をリロード促進
4. Phase 1 の利用者数（5-10名）では衝突頻度は低いが、基盤として入れておく

---

### O-03: 案件コードの採番ルール未定義

**リスク**: `project_code` は `TEXT UNIQUE NOT NULL` だが、フォーマットと採番ロジックが未定義。手入力だと重複・不統一が発生。

**対策**:
1. **フォーマット**: `YYYY-NNN`（例: `2026-001`, `2026-002`）
2. **自動採番**: `POST /api/projects` 実行時に年ごとの連番を自動生成
3. **採番ロジック**: 
   ```sql
   SELECT MAX(CAST(SUBSTR(project_code, 6) AS INTEGER))
   FROM projects
   WHERE project_code LIKE '2026-%'
   ```
4. **手動指定は不可**: APIで自動設定。UIからの上書きは管理者のみ。

---

### O-04: D1バックアップ/リストア戦略

**リスク**: D1はCloudflareのマネージドサービスだが、バックアップ/リストアの自動化が未計画。

**対策**:
1. **Cloudflare D1のTime Travel機能を活用**: 30日間の自動バックアップ（Cloudflare標準機能）
2. **週次の手動エクスポート**: `wrangler d1 export` で SQL ダンプを R2 に保存
3. **マスタデータのシード管理**: シードファイルはGitで管理し、いつでも再投入可能
4. **リストア手順書**: 障害発生時の復旧手順を `08_OPERATIONAL_RUNBOOK.md` に記載

---

### O-05: `project_warnings` の肥大化対策

**リスク**: 再計算のたびに警告レコードが蓄積され、テーブルが肥大化する。

**対策**:
1. **再計算時に既存警告をクリア**: `DELETE FROM project_warnings WHERE project_id = ? AND is_resolved = 0`
2. **解決済み警告のアーカイブ**: 90日経過した `is_resolved = 1` の警告を `project_audit_logs` に移動し、`project_warnings` から削除
3. **インデックス最適化**: `(project_id, is_resolved)` の複合インデックスは既に定義済み

---

### O-06: 単価有効期限チェック

**リスク**: `valid_from` / `valid_to` がある明細マスタについて、期限切れの単価で計算される可能性。

**対策**:
1. **計算エンジンで有効期限フィルタ**: 計算時に `WHERE is_active = 1 AND (valid_to IS NULL OR valid_to >= date('now'))` でフィルタ
2. **期限間近の警告**: 30日以内に `valid_to` を迎える明細マスタをダッシュボードに表示
3. **バッチ通知**: 週次で期限切れ間近のマスタを管理者にメール通知（Phase 2）

---

## 6. シードファイル固有の問題

### S-01: シード categories のカバー範囲

シードファイル `seed_categories_priority_a.json` には **10工種** のみ含まれているが、ドキュメントでは **37工種** が必要。

| シードに含まれる工種 | sort_order |
|---------------------|-----------|
| foundation | 80 |
| carpentry | 330 |
| insulation | 100 |
| shinkabe_panel | 110 |
| electrical_facility | 240 |
| roof | 210 |
| site_management | 350 |
| defect_insurance | 300 |
| cleaning | 280 |
| waste_box | 290 |

**不足**: 27工種分のシードファイルが未作成。

**対策**: Priority A のみを先行シード化したものと認識。残りの工種は Priority B/C として別途シードファイルを作成する計画を追加。

---

### S-02: シード items のスプレッドシートフィールド完全保持の確認

シードファイルの各アイテムに対し、5フィールドの保持状況:

| フィールド | シードの対応キー | 保持状態 |
|-----------|----------------|---------|
| 項目名 | `item_name` | OK - 全アイテムに存在 |
| 現行金額 | `current_unit_price` / `current_fixed_amount` | OK - 排他的に設定 |
| 備考 | `note` | OK - 一部null（元シートにも備考なし） |
| 発注先 | `vendor_name` | OK - 一部「未設定」または null |
| 算出根拠 | `calculation_basis_note` | OK - 全アイテムに存在 |

追加で `source_raw_json` に元データの生値が保持されており、**トレーサビリティは確保済み**。

---

### S-03: `section_type` フィールドがDBスキーマにない

シードファイルの `section_type: "basic" | "extra"` は `cost_master_items` の `item_group` に相当するが、値が異なる。

| シード | DB |
|--------|-----|
| `basic` | `basic` |
| `extra` | `additional` |

**解決方針**: シード側の `section_type` をDBの `item_group` にマッピング:
- `basic` → `basic`
- `extra` → `additional`
- または、DB側を `basic / extra / option` に変更してシードに合わせる（推奨）

---

### S-04: シード items の `ai_check_target` フィールドがDBスキーマにない

全アイテムに `ai_check_target: true` が設定されているが、DB `cost_master_items` にこのカラムがない。

**解決方針**: `cost_master_items` に `ai_check_target INTEGER DEFAULT 1` カラムを追加。OpenAI条件チェック（機能B）の対象かどうかのフラグ。

---

### S-05: シード items の `display_order` vs DB の存在しないカラム

シードファイルの `display_order` は明細の表示順を定義しているが、`cost_master_items` テーブルにこのカラムがない。

**解決方針**: `cost_master_items` に `display_order INTEGER DEFAULT 0` カラムを追加。工種内での明細表示順序を管理。

---

## 7. 推奨アクション（優先順序付き）

### 即座に対応（実装前の必須事項）

| # | アクション | 関連Issue | 影響度 |
|---|-----------|----------|--------|
| 1 | 工種数を全ドキュメントで37に統一 | C-01 | 高 |
| 2 | 計算方式を12パターンに整理し全ドキュメント統一 | C-02, C-05 | 高 |
| 3 | DBスキーマのPK方式を決定（TEXT vs INTEGER） | C-03 | 高 |
| 4 | `cost_master_item_versions` テーブルを追加 | C-04 | 高 |
| 5 | `base_fixed_amount` カラムをスキーマに追加 | C-06 | 高 |
| 6 | `cost_rule_conditions` をJSON構造に変更 | C-07 | 高 |
| 7 | カテゴリコードをシードファイルに統一 | C-09 | 高 |
| 8 | `final_*` 値の算出ロジックを明文化 | T-01 | 高 |
| 9 | 再計算時の手修正保持ルールを定義 | T-02 | 高 |
| 10 | スプレッドシート5フィールドのカラム名統一 | T-07 | 高 |

### 実装初期に対応

| # | アクション | 関連Issue | 影響度 |
|---|-----------|----------|--------|
| 11 | シードデータの `source_*` カラム追加 | T-08 | 中 |
| 12 | ルール衝突解決ポリシーを策定 | T-03 | 中 |
| 13 | `lineup_packages` のSSoT方針確定 | T-04 | 中 |
| 14 | 楽観ロック設計追加 | O-02 | 中 |
| 15 | 案件コード自動採番実装 | O-03 | 中 |
| 16 | 認証方式最終決定 | U-01 | 中 |
| 17 | D1バッチ分割の実装方針確定 | T-05 | 中 |

### 運用開始前に対応

| # | アクション | 関連Issue | 影響度 |
|---|-----------|----------|--------|
| 18 | マスタ変更通知メカニズム実装 | O-01 | 中 |
| 19 | 単価有効期限チェック実装 | O-06 | 中 |
| 20 | project_warnings 肥大化対策 | O-05 | 低 |
| 21 | D1バックアップ戦略文書化 | O-04 | 低 |
| 22 | 残り27工種のシードファイル作成 | S-01 | 高 |

---

## 8. 改訂ドキュメント一覧

本レビューの結果を反映して、以下のドキュメントを改訂する：

| ドキュメント | 改訂内容 |
|-------------|---------|
| 00_PROJECT_OVERVIEW.md | 用語統一（37工種、12計算方式）、カテゴリコード統一 |
| 01_DB_SCHEMA_DESIGN.md | 全Criticalの解決反映、新テーブル追加、カラム追加 |
| 02_COST_CALCULATION_DEFINITIONS.md | 計算方式12パターン、瑕疵担保保険金額確定 |
| 05_MASTER_DATA_PLAN.md | シードファイルとの対照表、残り工種の投入計画 |
| 06_PHASE1_IMPLEMENTATION_PLAN.md | リスク対策追加、工数見直し |
| 08_OPERATIONAL_RUNBOOK.md | 新規作成 - 運用手順・障害対応 |

---

*最終更新: 2026-03-07*
*レビュー実施者: システム設計フェーズ*
