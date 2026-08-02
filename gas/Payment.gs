/**
 * Fortune Lab ─ Stripe 決済（前払い / Checkout）
 * ----------------------------------------------------------------------
 * 予約フォームからの「予約して支払いへ」で呼ばれ、Stripe Checkout の
 * 決済ページURLを返す。支払い成功後、完了ページから確認APIが呼ばれ、
 * 入金を検証して Notion 予約DB に「支払済み」で予約を作成する。
 *
 *   料金 = 占い師DBの「鑑定料金」（未設定なら DEFAULT_PRICE）
 *
 * 【セットアップ】
 *  Apps Script「プロジェクトの設定 → スクリプト プロパティ」に登録:
 *     STRIPE_SECRET_KEY = sk_test_xxx（まずはテスト用シークレットキー）
 *  未設定の場合は決済をスキップし、従来どおり前払いなしで予約を受け付ける。
 * ----------------------------------------------------------------------
 */

// 占い師に料金が未設定のときの既定額（円）
const DEFAULT_PRICE = 5000;

function getStripeKey_() {
  return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
}

/** Stripe が有効か（キーが登録されているか） */
function isStripeEnabled_() {
  return !!getStripeKey_();
}

/**
 * 占い師DBから鑑定時間に応じた料金を取得。
 *   優先：料金{duration}分 → フォールバック：鑑定料金（単一） → DEFAULT_PRICE
 * @param {string} tellerPageId
 * @param {number} durationMin 30 / 60 / 90
 */
function getTellerPrice_(tellerPageId, durationMin) {
  if (!tellerPageId) return DEFAULT_PRICE;
  const token = getNotionToken_();
  if (!token) return DEFAULT_PRICE;
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + tellerPageId, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return DEFAULT_PRICE;
  const p = (JSON.parse(res.getContentText()) || {}).properties || {};
  const num = function (key) {
    return p[key] && typeof p[key].number === 'number' && p[key].number > 0 ? Math.round(p[key].number) : null;
  };
  // 1) 時間別料金
  const byDur = num('料金' + Number(durationMin) + '分');
  if (byDur) return byDur;
  // 2) 旧・単一料金にフォールバック
  const single = num('鑑定料金');
  if (single) return single;
  // 3) 既定額
  return DEFAULT_PRICE;
}

/**
 * Checkout セッションを作成し、決済ページURLを返す。
 * @param {Object} data 予約データ（reserve.astro から）
 * @return {TextOutput} { status:'checkout', url } / エラー
 */
function handleCheckout(data) {
  const r = normalizeReservation_(data); // 下記ヘルパー（Code.gs に定義）
  validateReservation_(r); // 必須・形式チェック（Code.gs に定義）

  // Stripe 未設定なら、従来どおり前払いなしで予約を確定
  if (!isStripeEnabled_()) {
    appendReservation(r);
    return jsonOutput({ status: 'success' });
  }

  // 空き枠の最終確認（決済ページに送る前）
  if (isSlotTaken_(r.tellerPageId, r.date, r.time, r.duration)) {
    throw new Error('その時間はちょうど予約が入りました。恐れ入りますが別の時間をお選びください。');
  }

  const amount = getTellerPrice_(r.tellerPageId, r.duration);
  const completeUrl = (data.completeUrl || '').toString();
  const cancelUrl = (data.cancelUrl || '').toString();
  if (!/^https?:\/\//.test(completeUrl) || !/^https?:\/\//.test(cancelUrl)) {
    throw new Error('戻り先URLが不正です。');
  }

  const productName =
    (r.tellerName ? r.tellerName : 'おまかせ') + ' / ' + r.menu +
    '（' + r.date + ' ' + r.time + '〜' + r.duration + '分）';

  const payload = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'jpy',
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][quantity]': '1',
    success_url: completeUrl + (completeUrl.indexOf('?') === -1 ? '?' : '&') + 'session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cancelUrl + (cancelUrl.indexOf('?') === -1 ? '?' : '&') + 'canceled=1',
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60), // 30分で失効
  };
  if (r.email) payload['customer_email'] = r.email;

  // 予約内容を metadata に格納（支払い後にこれを使って予約を作成）
  const meta = {
    userName: r.userName,
    userId: r.userId,
    email: r.email,
    phone: r.phone,
    tellerPageId: r.tellerPageId,
    tellerName: r.tellerName,
    menu: r.menu,
    date: r.date,
    time: r.time,
    duration: String(r.duration),
    note: (r.note || '').slice(0, 480),
    amount: String(amount),
  };
  Object.keys(meta).forEach(function (k) {
    payload['metadata[' + k + ']'] = meta[k];
  });

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + getStripeKey_() },
    payload: payload,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('決済の開始に失敗しました: ' + (body.error && body.error.message ? body.error.message : res.getResponseCode()));
  }
  return jsonOutput({ status: 'checkout', url: body.url });
}

/**
 * 支払い完了の確認：Checkout セッションを検証し、入金済みなら予約を作成。
 * 同じ session_id で二重作成しないよう冪等化。
 * @param {string} sessionId
 * @return {TextOutput}
 */
function confirmCheckout(sessionId) {
  if (!sessionId) throw new Error('session_id がありません。');
  if (!isStripeEnabled_()) throw new Error('決済が有効化されていません。');

  // すでに記録済みなら、それを返す（ページ再読込などの冪等化）
  const existing = findReservationBySession_(sessionId);
  if (existing) {
    return jsonOutput({ status: 'confirmed', already: true, summary: existing });
  }

  const res = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
    { method: 'get', headers: { Authorization: 'Bearer ' + getStripeKey_() }, muteHttpExceptions: true }
  );
  const s = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('決済情報の取得に失敗しました。');
  }
  if (s.payment_status !== 'paid') {
    return jsonOutput({ status: 'pending', message: 'お支払いが確認できませんでした。' });
  }

  const m = s.metadata || {};
  const r = normalizeReservation_(m);
  r.amount = Number(m.amount || 0);
  r.stripeSessionId = sessionId;

  // 二重予約なら拒否せず記録し、備考に注意書き（支払い済みを絶対に失わない）
  if (isSlotTaken_(r.tellerPageId, r.date, r.time, r.duration)) {
    r.note = '⚠️枠重複の可能性（要確認） ' + (r.note || '');
  }
  recordReservation_(r, { paid: true });

  const summary = { menu: r.menu, date: r.date, time: r.time, tellerName: r.tellerName, amount: r.amount };
  return jsonOutput({ status: 'confirmed', summary: summary });
}

/** session_id で既存予約を検索（冪等化用） */
function findReservationBySession_(sessionId) {
  const token = getNotionToken_();
  if (!token) return null;
  const res = UrlFetchApp.fetch(
    'https://api.notion.com/v1/databases/' + NOTION_RESERVATION_DB + '/query',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
      payload: JSON.stringify({
        filter: { property: '決済ID', rich_text: { equals: sessionId } },
        page_size: 1,
      }),
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return null;
  const rows = (JSON.parse(res.getContentText()) || {}).results || [];
  if (!rows.length) return null;
  const p = rows[0].properties || {};
  const txt = function (x) { return ((x && x.rich_text) || []).map(function (t) { return t.plain_text; }).join(''); };
  return {
    menu: (p['鑑定メニュー'] && p['鑑定メニュー'].select && p['鑑定メニュー'].select.name) || '',
    date: (p['日付'] && p['日付'].date && p['日付'].date.start) || '',
    time: txt(p['時間']),
    amount: (p['金額'] && p['金額'].number) || 0,
  };
}
