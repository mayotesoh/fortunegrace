/**
 * Fortune Grace ─ 予約を Notion「Fortune Grace 鑑定予約DB」へ同期する
 * ----------------------------------------------------------------------
 * appendReservation() から呼ばれ、スプレッドシート追記と“併せて”
 * Notion にも1ページ作成します。失敗してもスプシ記録は成立するよう、
 * 呼び出し側で try/catch して握りつぶします（記録優先）。
 *
 * 【セットアップ】
 *  1. Apps Script の「プロジェクトの設定 → スクリプト プロパティ」に登録:
 *        キー:  NOTION_TOKEN
 *        値:   ntn_xxxxxxxx...（Branchと同じインテグレーションのトークンでOK）
 *  2. 「Fortune Grace 鑑定予約DB」をそのインテグレーションに「コネクト」しておく。
 *  3. testNotionSync() を実行して Notion に行が出るか確認。
 * ----------------------------------------------------------------------
 */

// Fortune Grace 鑑定予約DB の Database ID（機密ではない）
const NOTION_RESERVATION_DB = 'e4fe0261c81546959d86c293a002ad3d';
const NOTION_VERSION = '2022-06-28';

/** Script Properties から Notion トークンを取得 */
function getNotionToken_() {
  return PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
}

/**
 * 予約1件を Notion 鑑定予約DB に作成
 * @param {{userName:string,userId:string,email:string,phone:string,
 *          tellerPageId:string,tellerName:string,menu:string,
 *          date:string,time:string,note:string}} r
 */
function syncReservationToNotion(r, opts) {
  opts = opts || {};
  const token = getNotionToken_();
  if (!token) {
    console.warn('NOTION_TOKEN 未設定のため Notion 同期をスキップ');
    return;
  }

  const properties = {
    '予約者': { title: [{ text: { content: r.userName || '（名称未設定）' } }] },
    'userId': { rich_text: [{ text: { content: r.userId || '' } }] },
    '時間': { rich_text: [{ text: { content: r.time || '' } }] },
    'ステータス': { select: { name: '未対応' } },
  };
  if (r.email) properties['メール'] = { email: r.email };
  if (r.phone) properties['電話番号'] = { phone_number: r.phone };
  if (r.date) properties['日付'] = { date: { start: r.date } };
  if (r.duration) properties['所要分'] = { number: Number(r.duration) };
  if (r.reserveType) properties['予約タイプ'] = { select: { name: r.reserveType } };
  if (r.menu) properties['鑑定メニュー'] = { select: { name: r.menu } };
  if (r.note) properties['備考'] = { rich_text: [{ text: { content: r.note } }] };
  // 希望占い師（占い師DBページIDが渡ってきた場合のみリレーションを設定）
  if (r.tellerPageId) {
    properties['希望占い師'] = { relation: [{ id: r.tellerPageId }] };
  }
  // 決済情報（PAY.JP前払い済みのとき）
  if (opts.paid) {
    properties['決済状態'] = { select: { name: '支払済み' } };
    if (r.amount) properties['金額'] = { number: Number(r.amount) };
    if (r.chargeId) {
      properties['決済ID'] = { rich_text: [{ text: { content: r.chargeId } }] };
    }
  }

  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': NOTION_VERSION,
    },
    payload: JSON.stringify({
      parent: { database_id: NOTION_RESERVATION_DB },
      properties: properties,
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Notion同期エラー ' + code + ': ' + res.getContentText());
  }
}

/** 【動作確認用】テスト予約を1件 Notion に作成する */
function testNotionSync() {
  syncReservationToNotion({
    userName: 'テスト予約',
    userId: 'test-' + new Date().getTime(),
    email: 'test@example.com',
    phone: '',
    tellerPageId: '', // 特定の占い師でテストしたい場合は占い師DBのページIDを入れる
    tellerName: '',
    menu: 'オンライン鑑定',
    date: '2026-07-20',
    time: '14:00',
    note: 'テスト送信です。',
  });
  console.log('OK: Notion にテスト予約を作成しました');
}
