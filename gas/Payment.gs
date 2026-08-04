/**
 * Lab online（仮） ─ PAY.JP 決済（前払い / カード課金）
 * ----------------------------------------------------------------------
 * 予約フォームで pay.js が発行したカードトークンを受け取り、PAY.JP の
 * 支払いAPIで課金 → 成功したら Notion 予約DB に「支払済み」で予約を作成する。
 *
 *   料金 = 占い師DBの時間別料金（料金{分}分 → 鑑定料金 → DEFAULT_PRICE）
 *
 * 【セットアップ】
 *  Apps Script「プロジェクトの設定 → スクリプト プロパティ」に登録:
 *     PAYJP_SECRET_KEY = sk_test_xxx（まずはテスト用シークレットキー）
 *  未設定の場合は決済をスキップし、従来どおり前払いなしで予約を受け付ける。
 * ----------------------------------------------------------------------
 */

// 占い師に料金が未設定のときの既定額（円）
const DEFAULT_PRICE = 5000;

function getPayjpKey_() {
  return PropertiesService.getScriptProperties().getProperty('PAYJP_SECRET_KEY');
}
function isPayjpEnabled_() {
  return !!getPayjpKey_();
}

/**
 * 占い師DBから鑑定時間に応じた料金を取得。
 *   優先：料金{duration}分 → フォールバック：鑑定料金（単一） → DEFAULT_PRICE
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
  const byDur = num('料金' + Number(durationMin) + '分');
  if (byDur) return byDur;
  const single = num('鑑定料金');
  if (single) return single;
  return DEFAULT_PRICE;
}

/**
 * PAY.JP でカードトークンを課金する（共通ヘルパー）。
 * @param {string} token pay.js のトークンID
 * @param {number} amount 金額（円）
 * @param {string} description 摘要
 * @param {Object} metadata 任意の付帯情報
 * @return {{paid:boolean, id:string}} 課金結果
 */
function payjpCharge_(token, amount, description, metadata) {
  const key = getPayjpKey_();
  if (!key) throw new Error('決済が有効化されていません（PAYJP_SECRET_KEY 未設定）。');
  if (!token) throw new Error('カード情報が確認できませんでした。');

  const payload = {
    amount: String(amount),
    currency: 'jpy',
    card: token,
  };
  if (description) payload['description'] = description;
  if (metadata) {
    Object.keys(metadata).forEach(function (k) {
      if (metadata[k] != null && metadata[k] !== '') payload['metadata[' + k + ']'] = String(metadata[k]).slice(0, 200);
    });
  }

  const res = UrlFetchApp.fetch('https://api.pay.jp/v1/charges', {
    method: 'post',
    // Basic認証：ユーザー名にシークレットキー、パスワードは空
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':') },
    payload: payload,
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    const msg = body && body.error ? body.error.message : '決済に失敗しました。';
    throw new Error(msg);
  }
  if (!body.paid) throw new Error('お支払いが承認されませんでした。');
  return { paid: true, id: body.id };
}

/**
 * 予約＋決済（reserve_charge）
 *   token あり かつ PAY.JP有効 → 課金して「支払済み」で予約
 *   それ以外 → 従来どおり前払いなしで予約
 * @param {Object} data 予約データ（reserve.astro から。token を含む場合あり）
 */
function handleReserveCharge(data) {
  const r = normalizeReservation_(data); // Code.gs
  validateReservation_(r); // Code.gs
  const token = (data.token || '').toString();

  // 決済オフ or トークン無し → 前払いなしで受付
  if (!isPayjpEnabled_() || !token) {
    appendReservation(r); // Code.gs（空き枠チェックあり）
    return jsonOutput({ status: 'success', paid: false });
  }

  // 空き枠の最終確認
  if (isSlotTaken_(r.tellerPageId, r.date, r.time, r.duration)) {
    throw new Error('その時間はちょうど予約が入りました。恐れ入りますが別の時間をお選びください。');
  }

  const amount = getTellerPrice_(r.tellerPageId, r.duration);
  const desc =
    (r.tellerName ? r.tellerName : 'おまかせ') + ' / ' + r.menu +
    '（' + r.date + ' ' + r.time + '〜' + r.duration + '分）';

  // 課金（失敗すれば例外→予約は作らない）
  const charge = payjpCharge_(token, amount, desc, {
    menu: r.menu, date: r.date, time: r.time, teller: r.tellerName,
  });

  // 決済成功 → 支払済みで予約を記録
  r.amount = amount;
  r.chargeId = charge.id;
  recordReservation_(r, { paid: true }); // Code.gs

  return jsonOutput({ status: 'success', paid: true, amount: amount });
}
