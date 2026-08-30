# Fortune Grace（フォーチュングレイス）

実力ある占い師が集う、オンライン占い館サイト。
**Astro** で構築し、**Notion** をコンテンツ管理元（占い師・ブログ・予約）として連携、
**GitHub Pages** に静的サイトとして公開します。

Branch（占い師向け教育コミュニティ）で育った人材を、一般のお客様に向けて紹介する
「表側」のサイトという位置づけで、Branch と同じ Notion ワークスペースで一元管理します。

## タブ構成

| タブ | ページ | 内容 |
| --- | --- | --- |
| ホーム | `/` | 鑑定メニュー・在籍占い師・予約の流れ・新着ブログ |
| 占い師 | `/tellers` | 占い師名簿（一覧）＋ 各占い師のプロフィール `/tellers/<id>` |
| ブログ | `/blog` | 記事一覧・記事詳細・著者別 `/blog/author/<id>` |
| 予約 | `/reserve` | 鑑定予約フォーム（占い師・メニュー・日時を選択） |

## Notion データベース（コンテンツ管理元）

| DB | Database ID | 用途 |
| --- | --- | --- |
| Fortune Grace 占い師DB | `507fd75b0aa94c48a259d05b6b211ea4` | 占い師名簿 |
| Fortune Grace ブログ記事DB | `de8681bc1b4f45eeaf77dba5fcfefa52` | ブログ（著者は占い師DBへのリレーション） |
| Fortune Grace 鑑定予約DB | `e4fe0261c81546959d86c293a002ad3d` | 予約管理（GASが追記） |

> Branch側：講師DB＋Branchブログ、Fortune Grace側：占い師DB＋Fortune Graceブログ、
> という住み分けで、同一ワークスペース内に共存します。

DB IDはコードに保持（機密ではない）。**トークン `NOTION_TOKEN` だけ**を
`.env`（ローカル）と GitHub Secrets（CI）に置きます。

## 開発

```bash
npm install
npm run dev      # http://localhost:4321/fortunegrace/
npm run build    # dist/ に静的出力
npm run preview  # ビルド結果をプレビュー
```

`.env` に Notion トークンが必要です:

```
NOTION_TOKEN=ntn_xxxxxxxx...
```

## デプロイ（GitHub Pages）

1. GitHub に `fortunegrace` リポジトリを作成（アカウント: `mayotesoh`）
2. **Settings → Secrets and variables → Actions** に `NOTION_TOKEN` を登録
3. **Settings → Pages → Source: GitHub Actions** に設定
4. `main` に push すると `.github/workflows/deploy.yml` が自動ビルド＆公開
   - 公開URL: `https://mayotesoh.github.io/fortunegrace/`
   - 定期ビルド（日本時間 朝9時・夜21時）で Notion の更新を自動反映
   - Actions タブの「Run workflow」で即時反映も可能

> 独自ドメインや `mayotesoh.github.io` リポジトリを使う場合は
> `astro.config.mjs` の `site` / `base` を変更してください。

## 予約フォームの有効化

予約フォームは Google Apps Script（GAS）経由で
スプレッドシート＋Notion鑑定予約DBに記録します。
`gas/README.md` の手順でGASをデプロイし、発行された `.../exec` URLを
`src/consts.ts` の `GAS_URL` に設定してください（未設定でもサイトは動作します）。

## 技術スタック

- Astro 5（静的出力）
- @notionhq/client / notion-to-md / marked（Notion → HTML）
- GitHub Actions → GitHub Pages
- Google Apps Script（予約バックエンド）

## 運用の流れ（コンテンツ更新）

1. Notion で占い師・ブログを編集し「公開」にする
2. 次回ビルド（定期 or 手動 or push）でサイトに反映
3. 予約はフォーム送信 → スプレッドシート＆鑑定予約DBに自動記録
