// サイト全体で使う共通定数

/** サイト名・キャッチ */
export const SITE_NAME = 'Lab online（仮）';
export const SITE_NAME_JA = 'Lab online（仮）';
export const SITE_TAGLINE = 'あなたの運命を照らす、オンライン占い館';

/**
 * 姉妹サイト（Fortune Labo）へのリンク
 * Lab online（仮） は相談者が鑑定を受けるサイト。
 * Fortune Labo はここで活躍する占い師の学び・育成コミュニティ。
 * ※ base が異なるため相手サイトへは絶対URLでリンクする。
 */
export const SISTER_SITE_URL = 'https://fortunelabo.com/';
export const SISTER_SITE_NAME = 'Fortune Labo';
export const SISTER_SITE_DESC = '占い師コミュニティ';

/**
 * 公式LINE 友だち追加・予約・相談リンク
 * 未設定（空文字）なら、LINE関連のボタンは表示されません。
 */
export const LINE_URL = 'https://lin.ee/rGGCtFe';

/** LINEボタンの既定ラベル */
export const LINE_LABEL = 'LINEで相談する';

/**
 * PAY.JP 公開鍵（pk_test_… / pk_live_…）
 * 公開鍵はクライアントに出しても安全。秘密鍵はGASのスクリプトプロパティへ。
 * ※ フロントの公開鍵とGASの秘密鍵は必ず同じモードにすること。
 * 本番切替時は下記を pk_live_13d6bd6a76607d4c6702a99b に差し替え、
 * GASの PAYJP_SECRET_KEY も本番用(sk_live_…)にする。
 */
export const PAYJP_PUBLIC_KEY = 'pk_test_58c51cb25eec8a844a85bdf8';

/**
 * 予約データ送信先（Google Apps Script ウェブアプリURL）
 * Lab online（仮） 用に新しく発行した GAS の /exec URL を設定してください。
 * gas/README.md のセットアップ手順を参照。
 * 未設定（空文字）の場合、予約フォームは送信できず案内メッセージを表示します。
 */
export const GAS_URL = 'https://script.google.com/macros/s/AKfycbwuK4iLVY-fHX0suCp8fHrr5ljlO6qjq68ba8mb0HKHh6KBFND9iRpMK3FcA1etztZP/exec';

/**
 * LIFF ID（LINE Developers コンソールで発行）
 * 未設定（空文字）の場合は、LINE外からの利用とみなして
 * 名前を手入力する「Web予約モード」で動作します。
 */
export const LIFF_ID = '2010514423-BkWdU821';

/**
 * 選べる鑑定時間（分）。GAS の Availability.gs の DURATION_OPTIONS と揃える。
 * 選んだ時間ぶんの枠を確保し、前後にインターバル（既定10分）を空けて空き枠を出す。
 */
export const DURATIONS = [30, 60, 90];

/** 予約の既定の鑑定時間（分） */
export const DEFAULT_DURATION = 60;

/** 鑑定メニュー（予約フォーム / 鑑定予約DBの「鑑定メニュー」と揃える） */
export const MENU_TYPES = [
  '対面鑑定',
  'オンライン鑑定',
  '電話鑑定',
  'チャット鑑定',
  'その他',
];
