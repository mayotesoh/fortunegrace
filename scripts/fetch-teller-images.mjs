// ─────────────────────────────────────────────────────────
// ビルド前に実行（npm の prebuild フックで自動起動）。
//
// 目的: 占い師の宣材写真を「ビルド時に」ダウンロードしてサイト内
//       （public/teller-images/）に保存する。
//
// なぜ必要か（リンク切れ対策）:
//   Notion にファイルを直接アップロードすると、画像URLは1時間ほどで
//   失効する S3 の署名付きURL になる。静的サイトが公開HTMLにその
//   URLを直接埋め込むと、再ビルド前に失効して画像が表示されなくなる。
//   → ここでローカルに落として自前配信すれば、どの作業者がどう
//     アップロードしても（ファイル添付でも外部URLでも）リンクは切れない。
//
// 写真が未設定の占い師には、神秘テーマの「仮の宣材写真」SVGを自動生成する。
//
// 出力:
//   public/teller-images/<slug>.<ext>        … 実画像 or 生成プレースホルダー
//   src/data/teller-images.json              … { [pageId]: 'teller-images/<file>' }
// ─────────────────────────────────────────────────────────
import { Client } from '@notionhq/client';
import fs from 'node:fs';
import path from 'node:path';

const TELLER_DB = '507fd75b0aa94c48a259d05b6b211ea4';
const OUT_DIR = path.resolve('public/teller-images');
const MANIFEST = path.resolve('src/data/teller-images.json');

// --- トークン取得: CIは環境変数、ローカルは .env ---
function getToken() {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN.trim();
  try {
    const env = fs.readFileSync(path.resolve('.env'), 'utf-8');
    return (env.match(/NOTION_TOKEN=(.+)/) || [])[1]?.trim();
  } catch {
    return undefined;
  }
}

const token = getToken();
if (!token) {
  console.warn('[teller-images] NOTION_TOKEN 未設定のためスキップ（既存の manifest を使用）。');
  process.exit(0);
}

const notion = new Client({ auth: token });

const pText = (p) => (p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text).join('');
const firstFileUrl = (p) => {
  const f = (p?.files ?? [])[0];
  return f ? f.external?.url ?? f.file?.url ?? '' : '';
};

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function extFromUrl(url) {
  const clean = url.split('?')[0];
  const m = clean.match(/\.(jpe?g|png|webp|gif|avif|svg)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
}

// --- 決定的な擬似乱数（slug から。ビルド毎に見た目を安定させる） ---
function makeRng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// --- 仮の宣材写真（神秘テーマの縦長SVG） ---
function placeholderSVG(name) {
  const rng = makeRng(name || 'fortune');
  const W = 600;
  const H = 800;
  const initial = [...(name || '☾')][0] ?? '☾';
  const hue = Math.floor(250 + rng() * 40); // 紫〜藍

  // 星々
  let stars = '';
  for (let i = 0; i < 46; i++) {
    const x = Math.round(rng() * W);
    const y = Math.round(rng() * H);
    const r = (rng() * 1.6 + 0.4).toFixed(2);
    const o = (rng() * 0.7 + 0.25).toFixed(2);
    stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
  }
  // きらめく大きめの星（4本線）
  let sparks = '';
  for (let i = 0; i < 5; i++) {
    const x = Math.round(60 + rng() * (W - 120));
    const y = Math.round(60 + rng() * (H - 200));
    const s = rng() * 6 + 5;
    const f = (n) => n.toFixed(1);
    sparks += `<path d="M${x} ${f(y - s)} L${x} ${f(y + s)} M${f(x - s)} ${y} L${f(x + s)} ${y}" stroke="#c9a227" stroke-width="1.4" opacity="0.85"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} の宣材写真（仮）">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="hsl(${hue},55%,22%)"/>
      <stop offset="0.55" stop-color="hsl(${hue - 8},60%,14%)"/>
      <stop offset="1" stop-color="#160f33"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.4" r="0.6">
      <stop offset="0" stop-color="rgba(201,162,39,0.35)"/>
      <stop offset="1" stop-color="rgba(201,162,39,0)"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${stars}
  ${sparks}
  <circle cx="${W / 2}" cy="330" r="150" fill="none" stroke="#c9a227" stroke-width="2" opacity="0.6"/>
  <circle cx="${W / 2}" cy="330" r="168" fill="none" stroke="#efe9ff" stroke-width="1" opacity="0.25"/>
  <text x="${W / 2}" y="330" text-anchor="middle" dominant-baseline="central"
        font-family="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif"
        font-size="150" fill="#efe9ff" opacity="0.95">${esc(initial)}</text>
  <text x="${W / 2}" y="560" text-anchor="middle"
        font-family="'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif"
        font-size="40" font-weight="700" fill="#efe9ff">${esc(name)}</text>
  <text x="${W / 2}" y="612" text-anchor="middle"
        font-family="'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif"
        font-size="20" fill="#c9a227" letter-spacing="4">FORTUNE GRACE</text>
  <text x="${W / 2}" y="720" text-anchor="middle"
        font-family="'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif"
        font-size="17" fill="#b6abdf">宣材写真は準備中です</text>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="20" fill="none" stroke="#c9a227" stroke-width="1.5" opacity="0.5"/>
</svg>`;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type] || extFromUrl(url) || 'jpg';
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ext };
}

async function main() {
  // クリーンにして作り直す（消えた占い師の残骸を残さない）
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });

  const rows = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: TELLER_DB,
      start_cursor: cursor,
      page_size: 100,
    });
    rows.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const manifest = {};
  let real = 0;
  let placeholder = 0;

  for (const r of rows) {
    const p = r.properties;
    const slug = pText(p['id']) || r.id.replace(/-/g, '');
    const name = pText(p['名前']) || slug;
    const url = firstFileUrl(p['顔写真']);

    let filename = '';
    if (url) {
      try {
        const { buf, ext } = await download(url);
        filename = `${slug}.${ext}`;
        fs.writeFileSync(path.join(OUT_DIR, filename), buf);
        real++;
        console.log(`[teller-images] ダウンロード: ${name} → ${filename}`);
      } catch (e) {
        console.warn(`[teller-images] ${name} の画像取得に失敗（${e.message}）→ 仮画像を生成`);
      }
    }
    if (!filename) {
      filename = `${slug}.svg`;
      fs.writeFileSync(path.join(OUT_DIR, filename), placeholderSVG(name), 'utf-8');
      placeholder++;
      console.log(`[teller-images] 仮画像を生成: ${name} → ${filename}`);
    }
    manifest[r.id] = `teller-images/${filename}`;
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`[teller-images] 完了: 実画像 ${real} / 仮画像 ${placeholder} → ${path.relative(process.cwd(), MANIFEST)}`);
}

main().catch((e) => {
  console.error('[teller-images] エラー:', e);
  process.exit(1);
});
