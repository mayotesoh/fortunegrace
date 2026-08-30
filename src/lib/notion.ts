import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';

// DB ID は機密ではないためコードに保持。トークンだけ環境変数（.env / CI Secret）。
// ─────────────────────────────────────────────────────────
// Fortune Grace の3つのデータベース
//   占い師DB     … 占い師名簿（一覧・詳細ページ）
//   ブログ記事DB … Fortune Graceブログ（著者は占い師DBへのリレーション）
//   鑑定予約DB   … 予約管理（GAS から追記。ビルドでは読まない）
// ─────────────────────────────────────────────────────────
export const TELLER_DB = '507fd75b0aa94c48a259d05b6b211ea4';
export const BLOG_DB = 'de8681bc1b4f45eeaf77dba5fcfefa52';
export const RESERVATION_DB = 'e4fe0261c81546959d86c293a002ad3d';

const token =
  (import.meta.env as any).NOTION_TOKEN ?? process.env.NOTION_TOKEN;

if (!token) {
  throw new Error(
    'NOTION_TOKEN が未設定です。ローカルは .env に、CI は GitHub Secrets に設定してください。'
  );
}

const notion = new Client({ auth: token });
const n2m = new NotionToMarkdown({ notionClient: notion });

// ---- プロパティ取り出しヘルパー ----
const pText = (p: any) =>
  (p?.title ?? p?.rich_text ?? []).map((t: any) => t.plain_text).join('');
const pMulti = (p: any) => (p?.multi_select ?? []).map((o: any) => o.name);
const pDate = (p: any) => p?.date?.start ?? '';
const pNumber = (p: any) => (typeof p?.number === 'number' ? p.number : 0);
const pFile = (p: any) => {
  const f = (p?.files ?? [])[0];
  return f ? f.external?.url ?? f.file?.url ?? '' : '';
};
const pRelIds = (p: any) => (p?.relation ?? []).map((r: any) => r.id);

// ---- ローカル画像パス解決（base 付き。無ければ Notion の生URLにフォールバック）----
// prebuild スクリプト（scripts/fetch-teller-images.mjs）が生成する pageId→ローカル画像
// の対応表を読む。写真をサイト内に自前配信することで Notion 署名付きURLの失効
// （＝リンク切れ）を防ぐ。未生成なら空 → Notion の生URLに自動フォールバック。
const BASE = (import.meta.env.BASE_URL as string) || '/';
const withBase = (p: string) =>
  `${BASE.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
let imageMap: Record<string, string> = {};
try {
  // ビルドはプロジェクトルートで実行されるため cwd 基準で確実に読む
  // （バンドル後は import.meta.url が別位置を指すため使わない）。
  imageMap = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'src/data/teller-images.json'), 'utf-8')
  );
} catch {
  // manifest 未生成（prebuild 未実行）— 生URLフォールバックで動作
}
const resolveImage = (pageId: string, files: any) => {
  const local = imageMap[pageId];
  return local ? withBase(local) : pFile(files);
};

// ---- 型 ----
export interface Teller {
  pageId: string;
  id: string;
  name: string;
  kana: string;
  role: string;
  catch: string;
  intro: string;
  image: string;
  arts: string[];
  styles: string[];
  styleDesc: string;
  specialties: string[];
  schedule: string;
  price: string;
  /** 時間別料金（円）。未設定は 0 */
  price30: number;
  price60: number;
  price90: number;
  order: number;
}

export interface PostMeta {
  slug: string;
  title: string;
  authorId: string;
  authorName: string;
  authorImage: string;
  publishDate: Date;
  excerpt: string;
  cover: string;
  tags: string[];
}

// ---- ページ全件取得（ページネーション対応） ----
async function queryAll(database_id: string, extra: any = {}) {
  const out: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res: any = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
      ...extra,
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

// ---- キャッシュ（ビルド中の重複取得を防ぐ） ----
let _tellers: Promise<Teller[]> | null = null;
let _posts: Promise<PostMeta[]> | null = null;

/** 公開中の占い師（表示順の昇順） */
export function getTellers(): Promise<Teller[]> {
  if (!_tellers) {
    _tellers = (async () => {
      const rows = await queryAll(TELLER_DB, {
        filter: { property: '公開', checkbox: { equals: true } },
        sorts: [{ property: '表示順', direction: 'ascending' }],
      });
      return rows.map((r) => {
        const p = r.properties;
        return {
          pageId: r.id,
          id: pText(p['id']) || r.id.replace(/-/g, ''),
          name: pText(p['名前']),
          kana: pText(p['よみ']),
          role: pText(p['肩書き']),
          catch: pText(p['キャッチコピー']),
          intro: pText(p['紹介文']),
          image: resolveImage(r.id, p['顔写真']),
          arts: pMulti(p['占術']),
          styles: pMulti(p['鑑定スタイル']),
          styleDesc: pText(p['鑑定スタイル説明']),
          specialties: pMulti(p['得意相談']),
          schedule: pText(p['受付時間']),
          price: pText(p['料金目安']),
          price30: p['料金30分']?.number ?? 0,
          price60: p['料金60分']?.number ?? 0,
          price90: p['料金90分']?.number ?? 0,
          order: pNumber(p['表示順']),
        } as Teller;
      });
    })();
  }
  return _tellers;
}

/** 公開中のブログ記事（公開日の降順） */
export function getPosts(): Promise<PostMeta[]> {
  if (!_posts) {
    _posts = (async () => {
      const tellers = await getTellers();
      const byPage = new Map(tellers.map((a) => [a.pageId, a]));
      const rows = await queryAll(BLOG_DB, {
        filter: { property: '公開状態', select: { equals: '公開' } },
        sorts: [{ property: '公開日', direction: 'descending' }],
      });
      return rows.map((r) => {
        const p = r.properties;
        const authorPage = pRelIds(p['著者'])[0];
        const author = authorPage ? byPage.get(authorPage) : undefined;
        const slug = pText(p['slug']) || r.id.replace(/-/g, '');
        return {
          slug,
          title: pText(p['タイトル']),
          authorId: author?.id ?? '',
          authorName: author?.name ?? '',
          authorImage: author?.image ?? '',
          publishDate: new Date(pDate(p['公開日']) || r.created_time),
          excerpt: pText(p['抜粋']),
          cover: pFile(p['カバー画像']),
          tags: pMulti(p['タグ']),
          _pageId: r.id,
        } as PostMeta & { _pageId: string };
      });
    })();
  }
  return _posts;
}

// ---- 占い師プロフィール本文（Notionページ本文 → HTML） ----
export async function getTellerHtml(id: string): Promise<string> {
  const tellers = await getTellers();
  const teller = tellers.find((t) => t.id === id);
  if (!teller) return '';
  const mdblocks = await n2m.pageToMarkdown(teller.pageId);
  const md = n2m.toMarkdownString(mdblocks).parent ?? '';
  return await marked.parse(md);
}

// ---- 記事本文（Markdown → HTML） ----
export async function getPostHtml(slug: string): Promise<string> {
  const posts = (await getPosts()) as (PostMeta & { _pageId: string })[];
  const post = posts.find((p) => p.slug === slug);
  if (!post) return '';
  const mdblocks = await n2m.pageToMarkdown(post._pageId);
  const md = n2m.toMarkdownString(mdblocks).parent ?? '';
  return await marked.parse(md);
}
