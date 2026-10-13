# Flight Checker

航空券と宿の価格を GitHub Actions で定期的に収集し、価格推移のグラフと「買い時の目安」を GitHub Pages で表示するサイトです。サーバーや DB は使わず、収集したデータは `data/` 配下の JSON としてリポジトリにコミットされます。

## 仕組み

```
GitHub Actions (cron 12時間ごと)
  └ scripts/collect.mjs   … 各プロバイダから運賃・宿泊料金を取得し data/prices/ と data/stays/ に追記
  └ scripts/analyze.mjs   … 履歴から統計と買い時判定を計算し data/summary.json を生成
  └ data/ をコミット
  └ scripts/build-site.mjs → GitHub Pages へデプロイ（site/ + data/）
```

## 価格の取得元（プロバイダ）

設定されているものはすべて併用され、グラフには取得元ごとの線が表示されます。

| 名前 | 内容 | 有効化 |
| --- | --- | --- |
| `serpapi` | SerpApi 経由の Google Flights。相場レンジ・Google の過去価格履歴も取得 | Secret `SERPAPI_KEY` |
| `duffel` | Duffel API の予約可能運賃（設定通貨と一致するもののみ） | Secret `DUFFEL_TOKEN` |
| `google-scrape` | Playwright で Google Flights のページを開いて運賃を読み取る | Variable `ENABLE_SCRAPER=1` |
| `mock` | 動作確認用のダミー価格 | Variable `PROVIDERS=mock` |

- Variable `PROVIDERS`（例: `serpapi,google-scrape`）を設定すると、使うプロバイダを明示的に指定できます。
- スクレイピングはページ構造の変更で動かなくなることがあります。対象サイトの利用規約に留意し、低頻度で使ってください。
- Duffel のテストトークン（`duffel_test_...`）は架空の運賃を返すため、実価格の参考にはなりません。

新しい取得元は `scripts/providers/` に `name` / `isEnabled(env)` / `fetchQuotes(route, ctx)` を持つモジュールを追加し、`scripts/providers/index.mjs` に登録すれば併用できます。

## 宿の価格の取得元

| 名前 | 内容 | 有効化 |
| --- | --- | --- |
| `serpapi` | SerpApi 経由の Google Hotels（安い順） | Secret `SERPAPI_KEY` |
| `rakuten` | 楽天トラベル空室検索 API（指定地点の半径内で空室のある宿） | Secret `RAKUTEN_APP_ID` と `RAKUTEN_ACCESS_KEY` |
| `mock` | 動作確認用のダミー料金 | Variable `PROVIDERS=mock` |

- 楽天ウェブサービスは 2026年5月に新 API（`openapi.rakuten.co.jp`）へ移行しており、アプリID に加えてアクセスキーが必要です。アプリ登録時に許可サイトの指定（Referer チェック）がある場合は、Variable `RAKUTEN_REFERER` にそのサイトの URL（例: `https://n0bisuke.github.io/flightchecker/`）を入れてください。
- 価格は宿泊合計（全泊分）で比較し、各回の「最安」と「中央値」を記録します。座標が分かる宿は指定半径の外を除外します。

## 監視する路線の設定

`config/routes.json` を編集します。出発日は `departDateFrom`〜`departDateTo` の範囲で指定でき、範囲内の各日を検索して最安の日を表示します（1日だけなら同じ日付を入れます）。`returnDate` を省略すると片道です。

```json
{
  "id": "TYO-CTS-1101-1105",
  "label": "東京 → 新千歳（11/1〜11/5）",
  "origin": ["HND", "NRT"],
  "originName": "Tokyo",
  "destination": ["CTS"],
  "destinationName": "New Chitose",
  "departDateFrom": "2026-11-01",
  "departDateTo": "2026-11-05",
  "adults": 1
}
```

- `origin` / `destination` は複数空港を配列で指定できます（SerpApi はまとめて1回、Duffel は組み合わせごとに検索）。
- `originName` / `destinationName` はスクレイピング時の検索語に使います（英語の都市名）。
- 1回の実行での API 呼び出し数は「全路線の候補日数の合計」です。出発日を過ぎた候補日は収集をスキップします。

## 監視する宿泊条件の設定

`config/stays.json` を編集します。

```json
{
  "id": "MORIOKA-ST-20270809-2N",
  "label": "盛岡駅周辺（8/9〜8/11 2泊3日）",
  "query": "盛岡駅 ホテル",
  "latitude": 39.7016,
  "longitude": 141.1366,
  "radiusKm": 1.5,
  "checkIn": "2027-08-09",
  "checkOut": "2027-08-11",
  "adults": 1
}
```

- `query` は Google Hotels の検索語、`latitude` / `longitude` / `radiusKm` は楽天の検索範囲と距離での絞り込みに使います（楽天の半径は最大 3km）。

## 買い時の目安

`scripts/lib/analysis.mjs` の経験則で判定しています（機械学習ではありません）。

| 判定 | 条件（上から順に評価） |
| --- | --- |
| 買い時 | 出発まで14日以内 / 相場レンジ下限以下 / 観測値の下位15%以内 / 出発30日以内かつ上昇傾向 |
| 待ち | 出発まで30日超で、直近7日が下落傾向 または 相場レンジ上限以上 |
| 様子見 | 上記以外 |

相場レンジは SerpApi の Google 典型価格帯を優先し、無い場合は自前の観測値の25〜75%点を使います（観測5回以上から）。

## セットアップ

1. リポジトリの **Settings → Pages → Source** を「GitHub Actions」にする
2. **Settings → Secrets and variables → Actions** で使うプロバイダの Secret / Variable を登録する
3. **Actions → Collect prices & deploy → Run workflow** で初回実行する

API の無料枠に合わせて `.github/workflows/collect.yml` の cron 間隔を調整してください（呼び出し回数 = 候補日数の合計 × 実行回数）。

## ローカルでの確認

```sh
npm install
npm test
npm run demo                     # モック価格で45日分の履歴を .demo-data/ に生成
DATA_DIR=.demo-data npm run serve # http://localhost:8080
```

実データの取得を手元で試す場合:

```sh
SERPAPI_KEY=xxx npm run collect
```
