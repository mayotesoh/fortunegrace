// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages 用の設定
// ─────────────────────────────────────────────────────────
// プロジェクトページ（https://mayotesoh.github.io/fortunegrace/）に
// デプロイする想定です。
//
//  - 独自ドメインや <ユーザー名>.github.io リポジトリを使う場合は
//    `base` を '/' に変更し、`site` を実際のURLに書き換えてください。
//  - リポジトリ名を変えた場合は `base` を合わせて変更してください。
// ─────────────────────────────────────────────────────────
export default defineConfig({
  site: 'https://mayotesoh.github.io',
  base: '/fortunegrace',
  output: 'static',
});
