/**
 * 片手タイピングトレーナー: アクセスコード確認と練習記録の受け取り(Google Apps Script)
 *
 * - action "verify":        アクセスコードが正しいか確認する
 * - action "log":           練習記録(1問クリアごと)をシートに追記する
 * - action "stats":         その端末の成績(振り返り画面用の集計)を返す
 * - action "admin_devices": 管理者用。端末の一覧を返す(要 ADMIN_CODE)
 * - action "admin_stats":   管理者用。指定した端末の成績を返す(要 ADMIN_CODE)
 *
 * アクセスコードはスクリプトプロパティ ACCESS_CODE、管理者用コードは ADMIN_CODE にだけ保存する
 * (このファイルや公開リポジトリには書かない)。設定手順は gas/README.md を参照。
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
  if (body.action === 'stats') {
    var deviceId = normalizeText_(body.deviceId);
    if (!deviceId) return respond_({ ok: false, error: 'bad_request' });
    return respond_({ ok: true, stats: buildStats_(readRecords_(deviceId), Date.now()) });
  }
  if (body.action === 'admin_devices' || body.action === 'admin_stats') return handleAdmin_(body, cache);
  return respond_({ ok: false, error: 'bad_request' });
}

// 管理者用。ACCESS_CODEに加えて、ADMIN_CODEも正しい場合だけ答える(間違いは総当たり対策の回数に数える)
function handleAdmin_(body, cache) {
  var adminCode = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
  if (!adminCode) return respond_({ ok: false, error: 'admin_not_configured' });
  if (!safeEqual_(String(body.adminCode || ''), adminCode)) {
    var fails = Number(cache.get('fails') || 0);
    cache.put('fails', String(fails + 1), FAIL_WINDOW_SECONDS);
    return respond_({ ok: false, error: 'invalid_admin' });
  }
  var records = readRecords_(null);
  if (body.action === 'admin_devices') {
    return respond_({ ok: true, devices: buildDeviceList_(records) });
  }
  var target = normalizeText_(body.targetDeviceId);
  if (!target) return respond_({ ok: false, error: 'bad_request' });
  return respond_({
    ok: true,
    stats: buildStats_(records.filter(function (r) { return r.deviceId === target; }), Date.now()),
  });
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

// ---- 成績の集計(振り返り画面用) ------------------------------------------

var JST_OFFSET_MS = 9 * 60 * 60 * 1000;
var DAY_MS = 24 * 60 * 60 * 1000;
var DAILY_DAYS = 14;
var MAX_CONFUSIONS = 10;
var MAX_DEVICES = 20;

// text_() が数式対策で付けた先頭の ' を外す
function normalizeText_(value) {
  return String(value === undefined || value === null ? '' : value).replace(/^'/, '');
}

// シートの全行を読み、deviceIdを指定したらその端末の分だけを返す
function readRecords_(deviceId) {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var records = [];
  values.forEach(function (row) {
    var rowDeviceId = normalizeText_(row[3]);
    if (deviceId && rowDeviceId !== deviceId) return;
    var wrong = [];
    try {
      var parsed = JSON.parse(String(row[12] || '[]'));
      if (Array.isArray(parsed)) wrong = parsed;
    } catch (err) {
      wrong = [];
    }
    records.push({
      receivedMs: row[0] instanceof Date ? row[0].getTime() : NaN,
      ts: normalizeText_(row[2]),
      deviceId: rowDeviceId,
      question: normalizeText_(row[8]).toLowerCase(),
      durationMs: Number(row[9]) || 0,
      attempts: Number(row[10]) || 0,
      mistakes: Number(row[11]) || 0,
      wrong: wrong,
    });
  });
  return records;
}

function recordTimeMs_(record) {
  var ms = Date.parse(record.ts);
  return isFinite(ms) ? ms : record.receivedMs;
}

// 日本時間の日付(yyyy-MM-dd)
function dateKey_(ms) {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function emptyDay_(date) {
  return { date: date, records: 0, practiceMs: 0, attempts: 0, mistakes: 0 };
}

/**
 * 1端末ぶんの記録から、振り返り画面に必要な集計を作る。
 * keys: 出題された回数(shown)と、そのキーを押し間違えた回数(misses)。
 * confusions: 「正しいキー → 押したキー」の多い順。
 */
function buildStats_(records, nowMs) {
  var days = {};
  var keys = {};
  var pairs = {};
  var totals = { records: 0, practiceMs: 0, attempts: 0, mistakes: 0 };

  records.forEach(function (record) {
    var ms = recordTimeMs_(record);
    if (!isFinite(ms)) return;
    var date = dateKey_(ms);
    var day = days[date] || (days[date] = emptyDay_(date));
    [day, totals].forEach(function (bucket) {
      bucket.records += 1;
      bucket.practiceMs += record.durationMs;
      bucket.attempts += record.attempts;
      bucket.mistakes += record.mistakes;
    });

    for (var i = 0; i < record.question.length; i++) {
      var ch = record.question.charAt(i);
      (keys[ch] || (keys[ch] = { shown: 0, misses: 0 })).shown += 1;
    }
    record.wrong.forEach(function (pair) {
      if (!Array.isArray(pair) || pair.length < 2) return;
      var expected = String(pair[0]).slice(0, 1).toLowerCase();
      var pressed = String(pair[1]).slice(0, 1).toLowerCase();
      if (!expected || !pressed) return;
      (keys[expected] || (keys[expected] = { shown: 0, misses: 0 })).misses += 1;
      var pairKey = expected + '>' + pressed;
      pairs[pairKey] = (pairs[pairKey] || 0) + 1;
    });
  });

  var todayKey = dateKey_(nowMs);
  var daily = [];
  for (var back = DAILY_DAYS - 1; back >= 0; back--) {
    var key = dateKey_(nowMs - back * DAY_MS);
    daily.push(days[key] || emptyDay_(key));
  }

  // 今日まで(今日がまだなら昨日まで)に、何日続けて練習したか
  var streak = 0;
  var cursor = days[todayKey] ? nowMs : nowMs - DAY_MS;
  while (days[dateKey_(cursor)]) {
    streak += 1;
    cursor -= DAY_MS;
  }

  var confusions = Object.keys(pairs).map(function (pairKey) {
    var parts = pairKey.split('>');
    return { expected: parts[0], pressed: parts[1], count: pairs[pairKey] };
  }).sort(function (a, b) { return b.count - a.count; }).slice(0, MAX_CONFUSIONS);

  var dayKeys = Object.keys(days).sort();
  return {
    generatedAt: nowMs,
    totals: {
      records: totals.records,
      practiceMs: totals.practiceMs,
      attempts: totals.attempts,
      mistakes: totals.mistakes,
      days: dayKeys.length,
      firstDate: dayKeys.length ? dayKeys[0] : null,
      lastDate: dayKeys.length ? dayKeys[dayKeys.length - 1] : null,
    },
    today: days[todayKey] || emptyDay_(todayKey),
    streak: streak,
    daily: daily,
    keys: keys,
    confusions: confusions,
  };
}

// 管理者用の端末一覧(最後に練習した順)
function buildDeviceList_(records) {
  var devices = {};
  records.forEach(function (record) {
    var ms = recordTimeMs_(record);
    if (!record.deviceId || !isFinite(ms)) return;
    var device = devices[record.deviceId] || (devices[record.deviceId] = {
      deviceId: record.deviceId, records: 0, practiceMs: 0, firstMs: ms, lastMs: ms,
    });
    device.records += 1;
    device.practiceMs += record.durationMs;
    device.firstMs = Math.min(device.firstMs, ms);
    device.lastMs = Math.max(device.lastMs, ms);
  });
  return Object.keys(devices).map(function (id) { return devices[id]; })
    .sort(function (a, b) { return b.lastMs - a.lastMs; })
    .slice(0, MAX_DEVICES);
}
