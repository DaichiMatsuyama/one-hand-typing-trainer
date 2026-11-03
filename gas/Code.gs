/**
 * 片手タイピングトレーナー: アクセスコード確認と練習記録の受け取り(Google Apps Script)
 *
 * - action "verify": アクセスコードが正しいか確認する
 * - action "log":    練習記録(1問クリアごと)をシートに追記する
 *
 * アクセスコードはスクリプトプロパティ ACCESS_CODE にだけ保存する(このファイルや公開リポジトリには書かない)。
 * 設定手順は gas/README.md を参照。
 */

var SHEET_NAME = 'records';
var HEADERS = [
  'receivedAt', 'id', 'ts', 'deviceId', 'hand', 'level', 'includeSymbols',
  'layout', 'question', 'durationMs', 'attempts', 'mistakes', 'wrong',
];
var MAX_RECORDS_PER_REQUEST = 50;
// 間違ったコードが短時間に続いたら、確認を一時的に止める(総当たり対策)
var MAX_FAILS = 30;
var FAIL_WINDOW_SECONDS = 300;
var DEDUPE_SECONDS = 21600;

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond_({ ok: false, error: 'bad_request' });
  }

  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!expected) return respond_({ ok: false, error: 'not_configured' });

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) return respond_({ ok: false, error: 'locked' });

  if (!safeEqual_(String(body.code || ''), expected)) {
    cache.put('fails', String(fails + 1), FAIL_WINDOW_SECONDS);
    return respond_({ ok: false, error: 'invalid' });
  }

  if (body.action === 'verify') return respond_({ ok: true });
  if (body.action === 'log') return handleLog_(body, cache);
  return respond_({ ok: false, error: 'bad_request' });
}

function handleLog_(body, cache) {
  var records = Array.isArray(body.records) ? body.records.slice(0, MAX_RECORDS_PER_REQUEST) : [];
  var deviceId = text_(body.deviceId, 64);
  var rows = [];

  records.forEach(function (record) {
    if (!record || typeof record !== 'object') return;
    var id = text_(record.id, 64);
    if (!id || cache.get('rec_' + id)) return; // 再送された記録は二重に入れない
    rows.push([
      new Date(),
      id,
      text_(record.ts, 40),
      deviceId,
      text_(record.hand, 8),
      number_(record.level, 0, 3),
      record.includeSymbols === true,
      text_(record.layout, 8),
      text_(record.question, 40),
      number_(record.durationMs, 0, 86400000),
      number_(record.attempts, 0, 100000),
      number_(record.mistakes, 0, 100000),
      text_(JSON.stringify(Array.isArray(record.wrong) ? record.wrong.slice(0, 50) : []), 600),
    ]);
  });

  if (rows.length > 0) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet_();
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    } finally {
      lock.releaseLock();
    }
    rows.forEach(function (row) {
      cache.put('rec_' + row[1], '1', DEDUPE_SECONDS);
    });
  }
  return respond_({ ok: true, saved: rows.length });
}

function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  var spreadsheet = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 文字列として保存する。先頭が = + - @ のセルは数式として解釈されないよう ' を付ける
function text_(value, maxLength) {
  var s = String(value === undefined || value === null ? '' : value).slice(0, maxLength);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function number_(value, min, max) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function respond_(object) {
  return ContentService.createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}
