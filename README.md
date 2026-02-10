# 配送エリア調整ツール（行政区画版）

神奈川県・東京都町田市の配送担当を、行政区画ポリゴン単位で地図上から調整するためのWebツールです。

## できること

- 行政区画 GeoJSON（Polygon/MultiPolygon）を読み込み
- ポリゴンをクリック選択して `SGM / FUJ / YOK` に割当
- 自治体フィルタ、エリアID/名称ジャンプ
- 割当CSVの読込
- 割当結果のCSV出力

## 起動方法

```bash
cd /Users/tomoki/src/RGU
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開く。

## すぐ使うファイル（今回作成済み）

- 行政区画GeoJSON: `/Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson`
- 初期割当CSV: `/Users/tomoki/src/RGU/data/asis_admin_assignments.csv`
- 初期割当を埋め込んだGeoJSON（1ファイル版）: `/Users/tomoki/src/RGU/data/asis_admin_polygons.geojson`
- 細粒度ポリゴン（町丁目ベース, asis反映済み）: `/Users/tomoki/src/RGU/data/asis_fine_polygons.geojson`

この2つを順に読み込めば、東京+神奈川の対象行政区画に既存割当を反映した状態から調整を始められます。
または、`asis_admin_polygons.geojson` だけを読み込んでも同じ初期状態で開始できます。
細かい調整をしたい場合は `asis_fine_polygons.geojson` をGeoJSONとして読み込んでください。

## 入力データ仕様（GeoJSON）

- 形式: `FeatureCollection`
- 各 Feature は `Polygon` または `MultiPolygon`
- 座標: GeoJSON標準（WGS84, `[経度,緯度]`）

### `properties` の推奨列

必須相当（どれか1つ）:
- `area_id` / `area_code` / `code` / `id`
- `N03_007`（国土数値情報の行政コード）
- `zip_code` など郵便番号系キー（後方互換）

名称・フィルタ用（任意）:
- `area_name` / `name` / `名称`
- `municipality` / `市区町村` / `市区` / `N03_004` / `N03_005` / `対応エリア`

補足:
- 国土数値情報 `N03` では、政令市の区は `N03_004=市名` + `N03_005=区名` で保持されるため、アプリ側で `横浜市緑区` のように連結して扱います。

初期割当（任意）:
- `depot_code` / `depot` / `管轄デポ` / `担当デポ`
- 値は `SGM`,`FUJ`,`YOK` 推奨（`相模原`,`藤沢`,`横浜港北(...)` も自動変換）

## 割当CSV読込仕様

以下のどちらかでエリアを特定できます。

- `area_id` 系列（`area_id`,`area_code`,`N03_007`,`zip_code` など）
- `area_name` 系列（`area_name`,`name`,`名称`,`municipality`,`市区`,`対応エリア` など）

デポ列:
- `depot_code` / `depot` / `管轄デポ` / `担当デポ`

`asis.csv` のように `市区, 管轄デポ` を持つCSVも読み込み可能です。
同一行政区画に複数デポが混在する場合は競合として検知し、その区画は未割当にします（例: 横浜市青葉区）。

## 出力CSV

- `area_id`
- `area_name`
- `municipality`
- `depot_code`
- `depot_name`

## サンプルデータ

- `/Users/tomoki/src/RGU/data/sample-admin-areas.geojson`

UIの「行政区画サンプル読込」で読み込めます。

## 細粒度データ再生成

神奈川の町丁目KMZと `asis.csv` から細粒度ポリゴンを再生成できます。

```bash
python3 /Users/tomoki/src/RGU/scripts/build_fine_polygons_from_asis.py \
  --asis /Users/tomoki/src/RGU/asis.csv \
  --kanagawa-kmz-zip /Users/tomoki/Downloads/A002005212020DDKWC14.zip \
  --baseline /Users/tomoki/src/RGU/data/asis_admin_assignments.csv \
  --n03-fallback /Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson \
  --out /Users/tomoki/src/RGU/data/asis_fine_polygons.geojson
```
