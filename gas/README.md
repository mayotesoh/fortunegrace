# Fortune Grace 予約API（Google Apps Script）

サイトの予約フォームから送信された鑑定予約を、
**Google スプレッドシート**と **Notion「Fortune Grace 鑑定予約DB」**の
両方に記録する Web API です。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `Code.gs` | doPost・フォーム予約処理・スプレッドシート追記 |
| `NotionSync.gs` | 予約を Notion「鑑定予約DB」へ同期（スプシと二重記録） |

## セットアップ手順

### 1. スプレッドシートを用意
1. Google ドライブで新しいスプレッドシートを作成
2. URL の `/d/●●●●/edit` の **`●●●●` の部分がスプレッドシートID**
3. `Code.gs` の `SPREADSHEET_ID` に貼り付け

### 2. Apps Script プロジェクトを作成
1. [script.google.com](https://script.google.com/) →「新しいプロジェクト」
2. `Code.gs` と `NotionSync.gs` の内容を貼り付け（ファイルは「＋」で追加）

### 3. Notion 連携の設定
1. **プロジェクトの設定 → スクリプト プロパティ** に登録:
   - キー: `NOTION_TOKEN` / 値: `ntn_xxxx...`
     （Branchと同じインテグレーションのトークンでOK。DBを一元管理できます）
2. Notion で **「Fortune Grace 鑑定予約DB」をそのインテグレーションにコネクト**
   （すでに接続済みなら不要）
3. エディタで `testNotionSync()` を実行 → Notionにテスト行が出れば成功
   （不要な行は削除）

### 4. デプロイ
1. **デプロイ → 新しいデプロイ → 種類: ウェブアプリ**
2. 設定:
   - 実行するユーザー: **自分**
   - アクセスできるユーザー: **全員**
3. デプロイして表示される **ウェブアプリURL（`.../exec`）** をコピー
4. サイトの `src/consts.ts` の `GAS_URL` に貼り付け → コミット & 再デプロイ

> コードを更新したら **デプロイ → デプロイを管理 → 編集（鉛筆）→ 新バージョン → デプロイ**
> でURLを変えずに反映できます。

## スプレッドシートの列

```
受付日時 | 予約者 | userId | メール | 電話番号 | 希望占い師 | 鑑定メニュー | 日付 | 時間 | 備考
```

> 見出しを作り直したいときは、一度だけ `resetHeaders()` を実行
> （※既存データは消えます。テスト行の掃除に）。

## サイト → GAS の送信データ（参考）

```json
{
  "userName": "山田花子",
  "userId": "web-1720000000000",
  "email": "hanako@example.com",
  "phone": "090-1234-5678",
  "tellerPageId": "（占い師DBのページID。おまかせ時は空）",
  "tellerName": "春名 渼月",
  "menu": "オンライン鑑定",
  "date": "2026-07-20",
  "time": "14:00",
  "note": "仕事の相談です"
}
```

`tellerPageId` は Notion「希望占い師」リレーションに使われます
（サイト側が占い師DBのページIDを自動送信します）。

## レスポンス

| 状態 | 例 |
| --- | --- |
| 成功 | `{"status":"success"}` |
| 失敗 | `{"status":"error","message":"必須項目が不足しています…"}` |

## LINE 連携について

LINE 公式アカウントからの対話式予約や LIFF 予約を追加したい場合は、
Branch サイトの `gas/LineBot.gs` / `RichMenu.gs` と同じ方式で拡張できます。
サイト側は `src/consts.ts` の `LIFF_ID` / `LINE_URL` を設定すると
LINE関連のボタン・自動名前入力が有効になります。
