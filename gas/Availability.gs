/**
 * Fortune Grace ─ 占い師別の「空き枠」計算
 * ----------------------------------------------------------------------
 * サイトの予約フォームから GET で呼ばれ、指定した占い師・日付の
 * 「予約できる時間（空き枠）」を返す。
 *
 *   空き枠 = その占い師の営業枠（曜日・時間） − 既存予約 − 過去の時刻（当日）
 *
 * 営業枠は Notion「占い師DB」の以下プロパティで管理する（未設定なら既定値）:
 *   受付曜日 … マルチセレクト（月/火/水/木/金/土/日）
 *   受付開始 … 数値（時。例: 10 = 10:00 から）
 *   受付終了 … 数値（時。例: 22 = 最終枠 21:30 まで）
 *   休業日   … テキスト（YYYY-MM-DD をカンマ/改行区切りで複数可）
 *
 * NOTION_TOKEN / NOTION_VERSION / NOTION_RESERVATION_DB は NotionSync.gs と共有。
 * ----------------------------------------------------------------------
 */

// 占い師DB の Database ID（機密ではない）
const NOTION_TELLER_DB = '507fd75b0aa94c48a259d05b6b211ea4';

// 予約開始時刻の刻み（分）※10分刻みで選べる
const SLOT_MINUTES = 10;

// 鑑定と鑑定の間に必ず空ける時間（分）。連続鑑定のインターバル。
const BUFFER_MINUTES = 10;

// 選べる所要時間（分）と既定値
const DURATION_OPTIONS = [30, 60, 90];
const DEFAULT_DURATION = 60;

/** 占い師の営業枠が未設定のときの既定値（＝とりあえず予約を受けられる状態） */
function DEFAULT_OPEN_() {
  return { days: ['日', '月', '火', '水', '木', '金', '土'], startHour: 10, endHour: 22, holidays: [] };
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** YYYY-MM-DD → 曜日（日〜土） */
function weekdayJa_(dateStr) {
  const p = dateStr.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
}

/** "HH:MM" → 0時からの分 */
function hmToMin_(hm) {
  const p = String(hm).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

/** 0時からの分 → "HH:MM" */
function minToHm_(t) {
  return pad2_(Math.floor(t / 60)) + ':' + pad2_(t % 60);
}

/** 所要時間を正規化（不正なら既定値） */
function normalizeDuration_(d) {
  const n = Number(d);
  return DURATION_OPTIONS.indexOf(n) !== -1 ? n : DEFAULT_DURATION;
}

/**
 * 空き枠を返すメイン関数
 *   開始時刻は SLOT_MINUTES（10分）刻み。所要時間ぶんの枠を確保し、
 *   前後に BUFFER_MINUTES のインターバルを空けられる時刻だけを返す。
 * @param {string} tellerPageId 占い師DBのページID（空なら「おまかせ」＝既定営業枠）
 * @param {string} date YYYY-MM-DD
 * @param {number} durationMin 所要時間（分）
 * @return {{slots:string[], closed?:boolean, reason?:string, duration:number}}
 */
function getAvailableSlots(tellerPageId, date, durationMin) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date の形式が不正です（YYYY-MM-DD）。');
  }
  const dur = normalizeDuration_(durationMin);
  const av = tellerPageId ? getTellerAvailability_(tellerPageId) : DEFAULT_OPEN_();

  // 休業日
  if (av.holidays.indexOf(date) !== -1) {
    return { slots: [], closed: true, reason: 'holiday', duration: dur };
  }
  // 受付曜日外
  if (av.days.indexOf(weekdayJa_(date)) === -1) {
    return { slots: [], closed: true, reason: 'weekday', duration: dur };
  }

  const openStart = av.startHour * 60;
  const openEnd = av.endHour * 60;
  const booked = tellerPageId ? getBookedIntervals_(tellerPageId, date) : [];

  const todayJst = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const nowMin = hmToMin_(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm'));

  const slots = [];
  for (let t = openStart; t + dur <= openEnd; t += SLOT_MINUTES) {
    if (date === todayJst && t <= nowMin) continue; // 当日の過去時刻
    if (!isFree_(t, dur, booked)) continue; // 既存予約＋インターバルと衝突
    slots.push(minToHm_(t));
  }
  return { slots: slots, duration: dur };
}

/**
 * [start, start+dur) が既存予約と重ならず、前後に BUFFER_MINUTES 空くか
 * @param {number} start 開始（分）
 * @param {number} dur 所要（分）
 * @param {{s:number,e:number}[]} booked 既存予約の区間
 */
function isFree_(start, dur, booked) {
  const end = start + dur;
  for (let i = 0; i < booked.length; i++) {
    const b = booked[i];
    // 「新規の終了＋インターバル ≦ 既存の開始」か「既存の終了＋インターバル ≦ 新規の開始」なら共存可
    const ok = end + BUFFER_MINUTES <= b.s || b.e + BUFFER_MINUTES <= start;
    if (!ok) return false;
  }
  return true;
}

/** 占い師の営業枠を Notion 占い師DB のページから取得（未設定は既定値で補完） */
function getTellerAvailability_(pageId) {
  const token = getNotionToken_();
  const def = DEFAULT_OPEN_();
  if (!token) return def;

  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return def;

  const p = (JSON.parse(res.getContentText()) || {}).properties || {};
  const days = ((p['受付曜日'] && p['受付曜日'].multi_select) || []).map(function (o) { return o.name; });
  const startHour =
    p['受付開始'] && typeof p['受付開始'].number === 'number' ? p['受付開始'].number : null;
  const endHour =
    p['受付終了'] && typeof p['受付終了'].number === 'number' ? p['受付終了'].number : null;
  const holidaysText = ((p['休業日'] && p['休業日'].rich_text) || [])
    .map(function (t) { return t.plain_text; })
    .join('');
  const holidays = holidaysText
    .split(/[,、\s]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); });

  return {
    days: days.length ? days : def.days,
    startHour: startHour !== null ? startHour : def.startHour,
    endHour: endHour !== null ? endHour : def.endHour,
    holidays: holidays,
  };
}

/**
 * その占い師・その日の「予約済み区間」を Notion 鑑定予約DB から取得
 * @return {{s:number,e:number}[]} 開始/終了（0時からの分）
 */
function getBookedIntervals_(tellerPageId, date) {
  const token = getNotionToken_();
  if (!token) return [];

  const res = UrlFetchApp.fetch(
    'https://api.notion.com/v1/databases/' + NOTION_RESERVATION_DB + '/query',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
      payload: JSON.stringify({
        filter: {
          and: [
            { property: '希望占い師', relation: { contains: tellerPageId } },
            { property: '日付', date: { equals: date } },
            { property: 'ステータス', select: { does_not_equal: 'キャンセル' } },
          ],
        },
      }),
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return [];

  const rows = (JSON.parse(res.getContentText()) || {}).results || [];
  const out = [];
  rows.forEach(function (r) {
    const props = r.properties || {};
    const t = props['時間'];
    const hm = ((t && t.rich_text) || []).map(function (x) { return x.plain_text; }).join('');
    if (!/^\d{2}:\d{2}$/.test(hm)) return;
    // 所要分が未設定の古い予約は既定値で扱う
    const d =
      props['所要分'] && typeof props['所要分'].number === 'number' && props['所要分'].number > 0
        ? props['所要分'].number
        : DEFAULT_DURATION;
    const s = hmToMin_(hm);
    out.push({ s: s, e: s + d });
  });
  return out;
}

/**
 * 送信時の二重予約チェック用：その枠が確保できないか
 * @param {number} durationMin 所要時間（分）
 */
function isSlotTaken_(tellerPageId, date, time, durationMin) {
  if (!tellerPageId) return false; // おまかせは占い師確定後に調整
  if (!/^\d{2}:\d{2}$/.test(String(time))) return false;
  const dur = normalizeDuration_(durationMin);
  return !isFree_(hmToMin_(time), dur, getBookedIntervals_(tellerPageId, date));
}

/** 【動作確認用】空き枠を取得してログ出力 */
function testAvailability() {
  const date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const result = getAvailableSlots('', date, 60); // 占い師おまかせ＝既定営業枠 / 60分
  console.log(JSON.stringify(result));
}
