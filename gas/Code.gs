/**
 * Fortune Lab ─ 鑑定予約受付 Google Apps Script（フォーム処理）
 * ----------------------------------------------------------------------
 * サイトの予約フォーム / LIFF からの JSON（text/plain）を受け取り、
 *   (1) Google スプレッドシートに1行追記
 *   (2) Notion「Fortune Lab 鑑定予約DB」に1ページ作成（NotionSync.gs）
 * します。
 *
 * スプレッドシートの列:
 *   受付日時 | 予約者 | userId | メール | 電話番号 | 希望占い師 | 鑑定メニュー | 日付 | 時間 | 備考
 * ----------------------------------------------------------------------
 */

// 予約データを書き込むスプレッドシートID（新規作成して貼り付けてください）
const SPREADSHEET_ID = 'ここに予約用スプレッドシートのIDを貼り付け';

// 見出し行
const HEADERS = [
  '受付日時',
  '予約者',
  'userId',
  'メール',
  '電話番号',
  '希望占い師',
  '鑑定メニュー',
  '日付',
  '時間',
  '備考',
];

/**
 * POST エントリーポイント
 *   { action:'checkout', ... } … Stripe決済ページURLを返す（Payment.gs）
 *   （それ以外）                … 前払いなしで予約を確定
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('リクエストボディが空です。');
    }
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'reserve_charge') {
      return handleReserveCharge(data); // Payment.gs（PAY.JP課金 or 前払いなし）
    }
    return handleFormReservation(data);
  } catch (err) {
    return jsonOutput({
      status: 'error',
      message: err && err.message ? err.message : String(err),
    });
  }
}

/** data（フォーム or Stripe metadata）→ 予約オブジェクトに正規化 */
function normalizeReservation_(data) {
  return {
    userName: (data.userName || '').toString(),
    userId: (data.userId || '').toString(),
    email: (data.email || '').toString(),
    phone: (data.phone || '').toString(),
    tellerPageId: (data.tellerPageId || '').toString(),
    tellerName: (data.tellerName || '').toString(),
    menu: (data.menu || '').toString(),
    date: (data.date || '').toString(),
    time: (data.time || '').toString(),
    duration: normalizeDuration_(data.duration), // 所要時間（分）
    note: (data.note || '').toString(),
  };
}

/** 必須・形式チェック（不正なら throw） */
function validateReservation_(r) {
  if (!r.userId || !r.menu || !r.date || !r.time) {
    throw new Error('必須項目が不足しています（userId / menu / date / time）。');
  }
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
    throw new Error('メールアドレスの形式が不正です。');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    throw new Error('date の形式が不正です（YYYY-MM-DD）。');
  }
  if (!/^\d{2}:\d{2}$/.test(r.time)) {
    throw new Error('time の形式が不正です（HH:MM）。');
  }
  if (DURATION_OPTIONS.indexOf(Number(r.duration)) === -1) {
    throw new Error('所要時間が不正です（' + DURATION_OPTIONS.join('/') + '分）。');
  }
}

/** サイトフォーム / LIFF からの予約を処理（前払いなし） */
function handleFormReservation(data) {
  const r = normalizeReservation_(data);
  validateReservation_(r);
  appendReservation(r);
  return jsonOutput({ status: 'success' });
}

/** 前払いなしの予約確定（空き枠チェックあり） */
function appendReservation(r) {
  recordReservation_(r, { check: true });
}

/**
 * 予約1件を記録（スプレッドシート追記 ＋ Notion同期）。ロックで直列化。
 * @param {Object} r 予約オブジェクト（r.amount / r.stripeSessionId は決済時のみ）
 * @param {{check?:boolean, paid?:boolean}} opts
 *        check: 記録前に二重予約チェックして重複なら throw（前払いなしの直接予約用）
 *        paid : 決済済みとしてNotionに金額・決済IDを記録
 */
function recordReservation_(r, opts) {
  opts = opts || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (opts.check && isSlotTaken_(r.tellerPageId, r.date, r.time, r.duration)) {
      throw new Error(
        '申し訳ありません。その時間はちょうど予約が入りました。別の時間をお選びください。'
      );
    }

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }
    sheet.appendRow([
      new Date(),
      r.userName || '',
      r.userId || '',
      r.email || '',
      r.phone || '',
      r.tellerName || '',
      r.menu || '',
      r.date || '',
      r.time || '',
      r.note || '',
    ]);

    // Notion「鑑定予約DB」にも同期（失敗してもスプシ記録は成立させる）。
    // ロック内で同期し、次の予約の空き枠チェックに反映されるようにする。
    try {
      syncReservationToNotion(r, opts); // NotionSync.gs
    } catch (err) {
      console.error('Notion同期に失敗しました: ' + (err && err.message ? err.message : err));
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * 【1回だけ手動実行】既存シートを見出し付きで作り直す。
 * ※ 既存データはすべて消えます。テスト行を消したいときに。
 */
function resetHeaders() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
  sheet.clear();
  sheet.appendRow(HEADERS);
}

/**
 * GET エントリーポイント
 *   ?action=slots&teller=<占い師ページID>&date=YYYY-MM-DD … 空き枠を返す
 *   （それ以外）… 動作確認メッセージ
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'slots') {
      const result = getAvailableSlots(
        (params.teller || '').toString(),
        (params.date || '').toString(),
        params.duration
      );
      return jsonOutput({
        status: 'success',
        slots: result.slots,
        closed: !!result.closed,
        duration: result.duration,
      });
    }
    return jsonOutput({ status: 'ok', message: 'Fortune Lab 予約API は稼働中です。' });
  } catch (err) {
    return jsonOutput({
      status: 'error',
      message: err && err.message ? err.message : String(err),
    });
  }
}

/** JSON レスポンス共通関数 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
