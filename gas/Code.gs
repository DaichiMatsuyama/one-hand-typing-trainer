/**
 * 片手タイピングトレーナー: アクセスコード確認と練習記録の受け取り(Google Apps Script)
 *
 * - action "verify":        アクセスコードが正しいか確認する
 * - action "log":           練習記録(1問クリアごと)をシートに追記する
 * - action "log_run":       練習記録(runごと)をrunsシートに追記する
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
var RUN_SHEET_NAME = 'runs';
// ホームポジション確認の4列は末尾へ追加した(既存の24列の並びは変えない)。
var RUN_HEADERS = [
  'receivedAt', 'id', 'ts', 'deviceId', 'mode', 'hand', 'level', 'includeSymbols',
  'layout', 'targetCount', 'timeLimitSec', 'homePosition', 'endedBy', 'activeMs',
  'inputMs', 'completedQuestions', 'correctCount', 'mistakes', 'attempts', 'accuracy',
  'kpm', 'menuOpenCount', 'rankVersion', 'appVersion',
  'hpSuccessCount', 'hpSkipCount', 'hpAvgReturnMs', 'hpMinReturnMs',
];
// ホームポジション列を追加する前の旧ヘッダー(24列)。1行目がこれと完全一致するときだけ、新4列を追記して移行する。
var LEGACY_RUN_HEADER_COUNT = 24;
var MAX_RUNS_PER_REQUEST = 20;
// 間違ったコードが短時間に続いたら、確認を一時的に止める(総当たり対策)
var MAX_FAILS = 30;
var FAIL_WINDOW_SECONDS = 300;
var FAILURE_CACHE_KEY = 'fails';
var LOCK_WAIT_MS = 1000;
var DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
var RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
var QUESTION_PATTERN = /^[a-z;,./@:_]{1,40}$/;
var WRONG_KEY_PATTERN = /^[a-z;,./@:_]$/;
var EARLIEST_RECORD_MS = Date.UTC(2020, 0, 1);
var MAX_FUTURE_RECORD_MS = 24 * 60 * 60 * 1000;
var APP_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond_({ ok: false, error: 'bad_request' });
  }
  if (!isPlainObject_(body)) return respond_({ ok: false, error: 'bad_request' });

  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!expected) return respond_({ ok: false, error: 'not_configured' });

  var cache = CacheService.getScriptCache();
  var isAdminAction = body.action === 'admin_devices' || body.action === 'admin_stats';
  // 管理者操作は両方のコードが正しいときだけ成功として失敗回数を消す。
  // 先にACCESS_CODEだけで消すと、ADMIN_CODEの失敗が1回より増えないため。
  var accessResult = checkCode_(String(body.code || ''), expected, cache, isAdminAction);
  if (accessResult) return respond_({ ok: false, error: accessResult });

  if (body.action === 'verify') return respond_({ ok: true });
  if (body.action === 'log') return handleLog_(body);
  if (body.action === 'log_run') return handleRunLog_(body);
  if (body.action === 'stats') {
    var deviceId = validDeviceId_(body.deviceId);
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
  var adminResult = checkCode_(String(body.adminCode || ''), adminCode, cache, false);
  if (adminResult) {
    return respond_({ ok: false, error: adminResult === 'invalid' ? 'invalid_admin' : adminResult });
  }
  var records = readRecords_(null);
  if (body.action === 'admin_devices') {
    return respond_({ ok: true, devices: buildDeviceList_(records) });
  }
  var target = validDeviceId_(body.targetDeviceId);
  if (!target) return respond_({ ok: false, error: 'bad_request' });
  return respond_({
    ok: true,
    stats: buildStats_(records.filter(function (r) { return r.deviceId === target; }), Date.now()),
  });
}

function handleLog_(body) {
  var deviceId = validDeviceId_(body.deviceId);
  if (!deviceId) return respond_({ ok: false, error: 'bad_request' });

  var sourceRecords = Array.isArray(body.records) ? body.records : [];
  var records = sourceRecords.slice(0, MAX_RECORDS_PER_REQUEST);
  var rejected = Math.max(0, sourceRecords.length - MAX_RECORDS_PER_REQUEST);
  var candidates = [];

  records.forEach(function (record) {
    var normalized = normalizeRecord_(record);
    if (!normalized) {
      rejected += 1;
      return;
    }
    candidates.push(normalized);
  });

  var rows = [];
  if (candidates.length > 0) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet_(SHEET_NAME, HEADERS);
      var lastRow = sheet.getLastRow();
      var existingIds = new Set();
      if (lastRow >= 2) {
        sheet.getRange(2, 2, lastRow - 1, 1).getValues().forEach(function (row) {
          existingIds.add(normalizeText_(row[0]));
        });
      }
      candidates.forEach(function (record) {
        if (existingIds.has(record.id)) return;
        existingIds.add(record.id); // 同一バッチ内の重複もここで除く
        rows.push([
          new Date(), record.id, text_(record.ts, 40), deviceId, record.hand, record.level,
          record.includeSymbols, record.layout, text_(record.question, 40),
          record.durationMs, record.attempts, record.mistakes,
          text_(JSON.stringify(record.wrong), 600),
        ]);
      });
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      }
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
  return respond_({ ok: true, saved: rows.length, rejected: rejected });
}

function handleRunLog_(body) {
  var deviceId = validDeviceId_(body.deviceId);
  if (!deviceId) return respond_({ ok: false, error: 'bad_request' });

  var sourceRecords = Array.isArray(body.records) ? body.records : [];
  var records = sourceRecords.slice(0, MAX_RUNS_PER_REQUEST);
  var rejected = Math.max(0, sourceRecords.length - MAX_RUNS_PER_REQUEST);
  var rejectedIds = [];
  var candidates = [];

  sourceRecords.slice(MAX_RUNS_PER_REQUEST).forEach(function (record) {
    addRejectedId_(rejectedIds, record);
  });

  records.forEach(function (record) {
    var normalized = normalizeRunRecord_(record);
    if (!normalized) {
      rejected += 1;
      addRejectedId_(rejectedIds, record);
      return;
    }
    candidates.push(normalized);
  });

  var rows = [];
  if (candidates.length > 0) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet_(RUN_SHEET_NAME, RUN_HEADERS, true);
      if (!sheet) return respond_({ ok: false, error: 'sheet_header_mismatch' });
      var lastRow = sheet.getLastRow();
      var existingIds = new Set();
      if (lastRow >= 2) {
        sheet.getRange(2, 2, lastRow - 1, 1).getValues().forEach(function (row) {
          existingIds.add(normalizeText_(row[0]));
        });
      }
      candidates.forEach(function (record) {
        if (existingIds.has(record.id)) return;
        existingIds.add(record.id);
        rows.push([
          new Date(), text_(record.id, 64), text_(record.ts, 40), text_(deviceId, 64),
          text_(record.mode, 20), text_(record.hand, 10), record.level,
          record.includeSymbols, text_(record.layout, 10), record.targetCount,
          record.timeLimitSec, record.homePosition, text_(record.endedBy, 20),
          record.activeMs, record.inputMs, record.completedQuestions, record.correctCount,
          record.mistakes, record.attempts, record.accuracy, record.kpm,
          record.menuOpenCount, record.rankVersion, text_(record.appVersion, 40),
          record.hpSuccessCount, record.hpSkipCount, record.hpAvgReturnMs, record.hpMinReturnMs,
        ]);
      });
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RUN_HEADERS.length).setValues(rows);
      }
      // ヘッダー移行・追記の反映を、ロックを手放す前に確定する(次のリクエストが古い状態を読まないように)。
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
  return respond_({
    ok: true,
    saved: rows.length,
    rejected: rejected,
    rejectedIds: rejectedIds,
  });
}

function addRejectedId_(ids, record) {
  if (ids.length >= MAX_RUNS_PER_REQUEST || !isPlainObject_(record)
    || typeof record.id !== 'string' || ids.indexOf(record.id) >= 0) return;
  ids.push(record.id);
}

function isPlainObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.prototype.toString.call(value) === '[object Object]';
}

function validDeviceId_(value) {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value) ? value : '';
}

function isIntegerInRange_(value, min, max) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value
    && value >= min && value <= max;
}

function normalizeRecord_(record) {
  if (!isPlainObject_(record)) return null;
  if (typeof record.id !== 'string' || !RECORD_ID_PATTERN.test(record.id)) return null;
  if (typeof record.ts !== 'string') return null;
  var timestamp = Date.parse(record.ts);
  if (!isFinite(timestamp) || timestamp < EARLIEST_RECORD_MS || timestamp > Date.now() + MAX_FUTURE_RECORD_MS) return null;
  if (record.hand !== 'left' && record.hand !== 'right') return null;
  if (!isIntegerInRange_(record.level, 1, 3)) return null;
  if (record.layout !== 'jis' && record.layout !== 'us') return null;
  if (typeof record.includeSymbols !== 'boolean') return null;
  if (typeof record.question !== 'string' || !QUESTION_PATTERN.test(record.question)) return null;
  if (typeof record.durationMs !== 'number' || !isFinite(record.durationMs)
    || record.durationMs < 0 || record.durationMs > 86400000) return null;
  if (!isIntegerInRange_(record.attempts, 0, 100000)) return null;
  if (!isIntegerInRange_(record.mistakes, 0, record.attempts)) return null;
  if (!Array.isArray(record.wrong) || record.wrong.length > 50) return null;

  var wrong = record.wrong.filter(function (pair) {
    return Array.isArray(pair) && pair.length === 2
      && typeof pair[0] === 'string' && WRONG_KEY_PATTERN.test(pair[0])
      && typeof pair[1] === 'string' && WRONG_KEY_PATTERN.test(pair[1]);
  });
  return {
    id: record.id,
    ts: record.ts,
    hand: record.hand,
    level: record.level,
    includeSymbols: record.includeSymbols,
    layout: record.layout,
    question: record.question,
    durationMs: record.durationMs,
    attempts: record.attempts,
    mistakes: record.mistakes,
    wrong: wrong,
  };
}

function normalizeRunRecord_(record) {
  if (!isPlainObject_(record)) return null;
  if (typeof record.id !== 'string' || !RECORD_ID_PATTERN.test(record.id)) return null;
  if (typeof record.ts !== 'string') return null;
  var timestamp = Date.parse(record.ts);
  if (!isFinite(timestamp) || timestamp < EARLIEST_RECORD_MS || timestamp > Date.now() + MAX_FUTURE_RECORD_MS) return null;
  if (record.mode !== 'free' && record.mode !== 'timeAttack' && record.mode !== 'timeLimit') return null;
  if (record.hand !== 'left' && record.hand !== 'right') return null;
  if (!isIntegerInRange_(record.level, 1, 3)) return null;
  if (typeof record.includeSymbols !== 'boolean') return null;
  if (record.layout !== 'jis' && record.layout !== 'us') return null;
  if (record.mode === 'free'
    && (record.targetCount !== null || record.timeLimitSec !== null)) return null;
  if (record.mode === 'timeAttack'
    && (!isIntegerInRange_(record.targetCount, 1, 1000) || record.timeLimitSec !== null)) return null;
  if (record.mode === 'timeLimit'
    && (!isIntegerInRange_(record.timeLimitSec, 1, 3600) || record.targetCount !== null)) return null;
  if (typeof record.homePosition !== 'boolean') return null;
  if (record.endedBy !== 'completed' && record.endedBy !== 'timeUp' && record.endedBy !== 'ended') return null;
  if (record.endedBy === 'completed' && record.mode !== 'timeAttack') return null;
  if (record.endedBy === 'timeUp' && record.mode !== 'timeLimit') return null;
  if (!isIntegerInRange_(record.activeMs, 0, 86400000)) return null;
  if (!isIntegerInRange_(record.inputMs, 0, 86400000)) return null;
  if (record.inputMs > record.activeMs + 1000) return null;
  if (!isIntegerInRange_(record.completedQuestions, 0, 100000)) return null;
  if (!isIntegerInRange_(record.correctCount, 0, 100000)) return null;
  if (!isIntegerInRange_(record.mistakes, 0, 100000)) return null;
  if (!isIntegerInRange_(record.attempts, 1, 100000)
    || record.correctCount + record.mistakes !== record.attempts) return null;
  var expectedAccuracy = Math.round(record.correctCount / record.attempts * 100);
  if (record.accuracy !== expectedAccuracy) return null;
  if (record.kpm !== null) {
    if (record.inputMs < 1000 || !isIntegerInRange_(record.kpm, 0, 6000001)) return null;
    var expectedKpm = Math.round(record.correctCount / (record.inputMs / 60000));
    if (Math.abs(record.kpm - expectedKpm) > 1) return null;
  }
  if (!isIntegerInRange_(record.menuOpenCount, 0, 1000)) return null;
  if (record.rankVersion !== undefined && record.rankVersion !== null
    && !isIntegerInRange_(record.rankVersion, 0, 999)) return null;
  var homePositionStats = normalizeHomePositionStats_(record);
  if (!homePositionStats) return null;

  return {
    id: record.id,
    ts: record.ts,
    mode: record.mode,
    hand: record.hand,
    level: record.level,
    includeSymbols: record.includeSymbols,
    layout: record.layout,
    targetCount: record.targetCount,
    timeLimitSec: record.timeLimitSec,
    homePosition: record.homePosition,
    endedBy: record.endedBy,
    activeMs: record.activeMs,
    inputMs: record.inputMs,
    completedQuestions: record.completedQuestions,
    correctCount: record.correctCount,
    mistakes: record.mistakes,
    attempts: record.attempts,
    accuracy: record.accuracy,
    kpm: record.kpm,
    menuOpenCount: record.menuOpenCount,
    rankVersion: record.rankVersion === undefined || record.rankVersion === null ? '' : record.rankVersion,
    appVersion: typeof record.appVersion === 'string' && APP_VERSION_PATTERN.test(record.appVersion)
      ? record.appVersion : 'unknown',
    hpSuccessCount: homePositionStats.hpSuccessCount,
    hpSkipCount: homePositionStats.hpSkipCount,
    hpAvgReturnMs: homePositionStats.hpAvgReturnMs,
    hpMinReturnMs: homePositionStats.hpMinReturnMs,
  };
}

// ホームポジション確認の4項目。旧クライアントの記録(省略)も受理し、省略・nullは空欄で保存する。
// 値があるときは範囲と整合(OFFなら回数0・時間なし / 成功0なら時間なし / 最短 <= 平均)を確認する。
// 確認ありのrunは4項目が必須で、成功+スキップ <= 完了問題数、平均 <= 総経過時間なども確認する。
function normalizeHomePositionStats_(record) {
  var strict = record.homePosition === true;
  var fields = ['hpSuccessCount', 'hpSkipCount', 'hpAvgReturnMs', 'hpMinReturnMs'];
  var values = {};
  for (var i = 0; i < fields.length; i++) {
    var value = record[fields[i]];
    values[fields[i]] = value === undefined || value === null ? null : value;
  }
  var success = values.hpSuccessCount;
  var skip = values.hpSkipCount;
  var avg = values.hpAvgReturnMs;
  var min = values.hpMinReturnMs;
  if (success !== null && !isIntegerInRange_(success, 0, 100000)) return null;
  if (skip !== null && !isIntegerInRange_(skip, 0, 100000)) return null;
  if (avg !== null && !isIntegerInRange_(avg, 0, 86400000)) return null;
  if (min !== null && !isIntegerInRange_(min, 0, 86400000)) return null;
  if (record.homePosition === false
    && ((success !== null && success > 0) || (skip !== null && skip > 0)
      || avg !== null || min !== null)) return null;
  if (success === 0 && (avg !== null || min !== null)) return null;
  if (avg !== null && min !== null && min > avg) return null;
  if (strict) {
    // 確認ありのrunは、回数と時間が互いに矛盾しない完全な組で送られる。
    if (success === null || skip === null) return null;
    if (success > 0 && (avg === null || min === null)) return null;
    if (success + skip > record.completedQuestions) return null;
    if (avg !== null && (avg > record.activeMs || avg * success > record.activeMs + 1000)) return null;
  }
  return {
    hpSuccessCount: success === null ? '' : success,
    hpSkipCount: skip === null ? '' : skip,
    hpAvgReturnMs: avg === null ? '' : avg,
    hpMinReturnMs: min === null ? '' : min,
  };
}

// 固定ウィンドウの失敗回数を、短時間だけスクリプトロックで保護する。
// ロックを取れない場合は、並行リクエストによる回数制限のすり抜けを避けるため安全側でlockedにする。
function checkCode_(provided, expected, cache, deferReset) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return 'locked';
  try {
    var now = Date.now();
    var state = readFailureState_(cache, now);
    if (state.count >= MAX_FAILS) return 'locked';
    if (!safeEqual_(provided, expected)) {
      if (state.count === 0) state.start = now;
      state.count += 1;
      var remainingMs = FAIL_WINDOW_SECONDS * 1000 - (now - state.start);
      cache.put(FAILURE_CACHE_KEY, JSON.stringify(state), Math.max(1, Math.ceil(remainingMs / 1000)));
      return 'invalid';
    }
    if (!deferReset) cache.remove(FAILURE_CACHE_KEY);
    return '';
  } finally {
    lock.releaseLock();
  }
}

function readFailureState_(cache, now) {
  var state = null;
  try {
    state = JSON.parse(cache.get(FAILURE_CACHE_KEY) || 'null');
  } catch (err) {
    state = null;
  }
  if (!state || !isIntegerInRange_(state.count, 0, MAX_FAILS + 100000)
    || typeof state.start !== 'number' || !isFinite(state.start)
    || now - state.start >= FAIL_WINDOW_SECONDS * 1000 || state.start > now) {
    cache.remove(FAILURE_CACHE_KEY);
    return { count: 0, start: now };
  }
  return state;
}

function getSheet_(sheetName, headers, validateHeaders) {
  sheetName = sheetName || SHEET_NAME;
  headers = headers || HEADERS;
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  var spreadsheet = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    ensureColumns_(sheet, headers.length);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (validateHeaders) {
    if (!validateOrMigrateHeaders_(sheet, headers)) return null;
  }
  return sheet;
}

// シートの列数(グリッド)が足りないと、範囲外への書き込みが例外になる。必要な列数まで足す。
function ensureColumns_(sheet, count) {
  var maxColumns = sheet.getMaxColumns();
  if (maxColumns < count) sheet.insertColumnsAfter(maxColumns, count - maxColumns);
}

// 1行目が新ヘッダーと完全一致ならそのまま使う。旧ヘッダー(新ヘッダーの先頭24列)と完全一致なら、
// 新しい列の見出しだけを1行目の右へ追記して使う(既存のデータ行は触らない。新列は空欄のまま)。
// 呼び出し元がロックを取っている間に実行すること(移行の二重実行を防ぐ)。
function validateOrMigrateHeaders_(sheet, headers) {
  var lastColumn = sheet.getLastColumn();
  var legacyCount = LEGACY_RUN_HEADER_COUNT;
  if (lastColumn !== headers.length && lastColumn !== legacyCount) return false;
  var actualHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (var i = 0; i < lastColumn; i++) {
    if (actualHeaders[i] !== headers[i]) return false;
  }
  if (lastColumn === legacyCount) {
    // 新規作成のシートは既定で26列。24列ちょうどのシートも含め、足りない列を先に足す。
    ensureColumns_(sheet, headers.length);
    var added = headers.slice(legacyCount);
    sheet.getRange(1, legacyCount + 1, 1, added.length).setValues([added]);
  }
  return true;
}

// 文字列として保存する。先頭が = + - @ のセルは数式として解釈されないよう ' を付ける
function text_(value, maxLength) {
  var s = String(value === undefined || value === null ? '' : value).slice(0, maxLength);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
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
  var sheet = getSheet_(SHEET_NAME, HEADERS);
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
