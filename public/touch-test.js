(function () {
  'use strict'

  var layouts = {
    left: [
      { offset: 0, keys: [['q', 'pinky'], ['w', 'ring'], ['e', 'middle'], ['r', 'index'], ['t', 'index']] },
      { offset: 0.25, keys: [['a', 'pinky'], ['s', 'ring'], ['d', 'middle'], ['f', 'index'], ['g', 'index']] },
      { offset: 0.75, keys: [['z', 'pinky'], ['x', 'ring'], ['c', 'middle'], ['v', 'index'], ['b', 'index']] },
    ],
    right: [
      { offset: 0, keys: [['y', 'index'], ['u', 'index'], ['i', 'middle'], ['o', 'ring'], ['p', 'pinky'], ['@', 'pinky']] },
      { offset: 0.25, keys: [['h', 'index'], ['j', 'index'], ['k', 'middle'], ['l', 'ring'], [';', 'pinky'], [':', 'pinky']] },
      { offset: 0.75, keys: [['n', 'index'], ['m', 'index'], [',', 'middle'], ['.', 'ring'], ['/', 'pinky'], ['_', 'pinky']] },
    ],
  }

  var homeKeys = {
    left: ['a', 's', 'd', 'f'],
    right: ['j', 'k', 'l', ';'],
  }

  var WAITING_MESSAGE = 'ホームポジションに4本の指を置いてください（順番でもOK）'
  var PLACING_MESSAGE = '4つのホームキーに指を置いてください'
  var CONFIRMED_MESSAGE = 'OK! 指を離してください'
  var RELEASING_MESSAGE = 'すべての指を離してください'
  var LOG_LIMIT = 15
  var SIMULTANEOUS_MS = 150

  var shell = document.querySelector('.test-shell')
  var surface = document.getElementById('touch-surface')
  var keyboard = document.getElementById('keyboard')
  var statusElement = document.querySelector('[data-testid="status"]')
  var pointerCountElement = document.getElementById('pointer-count')
  var touchCountElement = document.getElementById('touch-count')
  var resetButton = document.getElementById('reset-button')
  var resultButton = document.getElementById('result-button')
  var resultDialog = document.getElementById('result-dialog')
  var resultElement = document.querySelector('[data-testid="result"]')
  var fallbackElement = document.getElementById('copy-fallback')
  var copyMessage = document.getElementById('copy-message')

  var hand = 'left'
  var phase = 'waiting'
  var activePointers = new Map()
  var confirmedPointerIds = new Set()
  var lastTouchCount = 0
  var currentTrial = null
  var selectedHands = new Set([hand])
  var events = []
  var trials = []
  var stats = createEmptyStats()

  function createEmptyStats() {
    return {
      successes: 0,
      failures: 0,
      simultaneous: 0,
      sequential: 0,
      placementTimes: [],
      holdTimes: [],
      maxPointerContacts: 0,
      maxTouchContacts: 0,
      pointerCancelCount: 0,
      touchCancelCount: 0,
      otherKeyContacts: 0,
      outsideContacts: 0,
      pointerTypes: new Set(),
    }
  }

  function renderKeyboard() {
    keyboard.replaceChildren()
    shell.dataset.hand = hand
    shell.style.setProperty('--pitch-count', hand === 'right' ? '6.75' : '5.75')
    var targets = homeKeys[hand]

    layouts[hand].forEach(function (rowData) {
      var row = document.createElement('div')
      row.className = 'keyboard-row'
      row.style.setProperty('--row-offset', String(rowData.offset))

      rowData.keys.forEach(function (keyData) {
        var key = document.createElement('div')
        key.className = 'key finger-' + keyData[1]
        key.dataset.key = keyData[0]
        key.textContent = keyData[0]
        if (targets.indexOf(keyData[0]) !== -1) key.classList.add('home-target')
        row.appendChild(key)
      })

      keyboard.appendChild(row)
    })

    document.querySelectorAll('.hand-button').forEach(function (button) {
      var selected = button.dataset.hand === hand
      button.classList.toggle('selected', selected)
      button.setAttribute('aria-pressed', String(selected))
    })
    refreshPressedKeys()
  }

  function setPhase(nextPhase) {
    phase = nextPhase
    var messages = {
      waiting: WAITING_MESSAGE,
      placing: PLACING_MESSAGE,
      confirmed: CONFIRMED_MESSAGE,
      releasing: RELEASING_MESSAGE,
    }
    statusElement.textContent = messages[nextPhase]
  }

  function updateCounts() {
    pointerCountElement.textContent = 'P ' + activePointers.size
    touchCountElement.textContent = 'T ' + lastTouchCount
    var hasContacts = activePointers.size > 0
    document.querySelectorAll('.hand-button').forEach(function (button) {
      button.disabled = hasContacts
    })
    resetButton.disabled = hasContacts
    resultButton.disabled = hasContacts
  }

  function refreshPressedKeys() {
    var pressed = new Set()
    activePointers.forEach(function (pointer) {
      if (pointer.key) pressed.add(pointer.key)
    })
    document.querySelectorAll('[data-key]').forEach(function (key) {
      key.classList.toggle('pressed', pressed.has(key.dataset.key))
    })
  }

  function eventTime() {
    var now = new Date()
    var time = now.toLocaleTimeString('ja-JP', { hour12: false })
    return time + '.' + String(now.getMilliseconds()).padStart(3, '0')
  }

  function addLog(type, pointerId, key) {
    events.unshift({
      time: eventTime(),
      type: type,
      pointerId: pointerId == null ? '-' : pointerId,
      key: key === undefined ? '-' : key === null ? '鍵盤外' : key,
    })
    if (events.length > LOG_LIMIT) events.length = LOG_LIMIT
  }

  function keyFromEvent(event) {
    var element = event.target && event.target.closest ? event.target.closest('[data-key]') : null
    return element ? element.dataset.key : null
  }

  function startTrial(now) {
    currentTrial = {
      hand: hand,
      t0: now,
      t1: null,
      t2: null,
      placementMs: null,
      holdMs: null,
      mode: null,
      maxPointerContacts: activePointers.size,
      maxTouchContacts: lastTouchCount,
    }
    selectedHands.add(hand)
    setPhase('placing')
  }

  function updateTrialMaximums() {
    stats.maxPointerContacts = Math.max(stats.maxPointerContacts, activePointers.size)
    if (currentTrial) {
      currentTrial.maxPointerContacts = Math.max(currentTrial.maxPointerContacts, activePointers.size)
      currentTrial.maxTouchContacts = Math.max(currentTrial.maxTouchContacts, lastTouchCount)
    }
  }

  function findRequiredPointers() {
    var required = homeKeys[hand]
    var found = new Map()
    activePointers.forEach(function (pointer, pointerId) {
      if (required.indexOf(pointer.key) !== -1 && !found.has(pointer.key)) {
        found.set(pointer.key, pointerId)
      }
    })
    return found
  }

  function checkForConfirmation(now) {
    if (phase !== 'placing' || !currentTrial) return
    var found = findRequiredPointers()
    if (found.size !== homeKeys[hand].length) return

    currentTrial.t1 = now
    currentTrial.placementMs = Math.max(0, now - currentTrial.t0)
    currentTrial.mode = currentTrial.placementMs <= SIMULTANEOUS_MS ? 'simultaneous' : 'sequential'
    confirmedPointerIds = new Set(Array.from(found.values()))
    setPhase('confirmed')
  }

  function completeSuccessfulTrial(now) {
    if (!currentTrial) return
    if (currentTrial.t1 == null) currentTrial.t1 = now
    if (currentTrial.t2 == null) currentTrial.t2 = now
    if (currentTrial.holdMs == null) currentTrial.holdMs = Math.max(0, currentTrial.t2 - currentTrial.t1)

    stats.successes += 1
    if (currentTrial.mode === 'simultaneous') stats.simultaneous += 1
    if (currentTrial.mode === 'sequential') stats.sequential += 1
    stats.placementTimes.push(currentTrial.placementMs)
    stats.holdTimes.push(currentTrial.holdMs)
    trials.push(trialRecord(currentTrial, true))
    finishTrial()
  }

  function completeFailedTrial() {
    if (!currentTrial) return
    stats.failures += 1
    trials.push(trialRecord(currentTrial, false))
    finishTrial()
  }

  function trialRecord(trial, success) {
    return {
      hand: trial.hand,
      success: success,
      mode: trial.mode,
      placementMs: roundMs(trial.placementMs),
      holdMs: roundMs(trial.holdMs),
      maxPointerContacts: trial.maxPointerContacts,
      maxTouchContacts: trial.maxTouchContacts,
    }
  }

  function finishTrial() {
    currentTrial = null
    confirmedPointerIds.clear()
    setPhase('waiting')
  }

  function onPointerDown(event) {
    event.preventDefault()
    if (activePointers.has(event.pointerId)) return

    var key = keyFromEvent(event)
    var pointerType = event.pointerType || 'unknown'
    activePointers.set(event.pointerId, { key: key, pointerType: pointerType })
    stats.pointerTypes.add(pointerType)
    stats.maxPointerContacts = Math.max(stats.maxPointerContacts, activePointers.size)
    if (key == null) stats.outsideContacts += 1
    else if (homeKeys[hand].indexOf(key) === -1) stats.otherKeyContacts += 1
    addLog('pointerdown', event.pointerId, key)

    var now = performance.now()
    if (phase === 'waiting' && homeKeys[hand].indexOf(key) !== -1) startTrial(now)
    updateTrialMaximums()
    checkForConfirmation(now)
    refreshPressedKeys()
    updateCounts()
  }

  function onPointerFinish(event, isCancel) {
    var pointer = activePointers.get(event.pointerId)
    if (!pointer) return
    event.preventDefault()

    if (isCancel) stats.pointerCancelCount += 1
    addLog(isCancel ? 'pointercancel' : 'pointerup', event.pointerId, pointer.key)

    var now = performance.now()
    if (phase === 'confirmed' && confirmedPointerIds.has(event.pointerId) && currentTrial) {
      currentTrial.t2 = now
      currentTrial.holdMs = Math.max(0, now - currentTrial.t1)
      setPhase('releasing')
    }

    activePointers.delete(event.pointerId)
    confirmedPointerIds.delete(event.pointerId)
    refreshPressedKeys()
    updateCounts()

    if (activePointers.size !== 0) return
    if (phase === 'placing') completeFailedTrial()
    else if (phase === 'confirmed' || phase === 'releasing') completeSuccessfulTrial(now)
  }

  function onTouchEvent(event) {
    event.preventDefault()
    lastTouchCount = event.touches ? event.touches.length : 0
    stats.maxTouchContacts = Math.max(stats.maxTouchContacts, lastTouchCount)
    if (currentTrial) currentTrial.maxTouchContacts = Math.max(currentTrial.maxTouchContacts, lastTouchCount)
    if (event.type === 'touchcancel') stats.touchCancelCount += 1
    addLog(event.type + '(' + lastTouchCount + ')', null, undefined)
    updateCounts()
  }

  function resetAll() {
    if (activePointers.size) return
    stats = createEmptyStats()
    events = []
    trials = []
    currentTrial = null
    confirmedPointerIds.clear()
    lastTouchCount = 0
    selectedHands = new Set([hand])
    setPhase('waiting')
    updateCounts()
    refreshPressedKeys()
  }

  function switchHand(nextHand) {
    if (activePointers.size || nextHand === hand || !layouts[nextHand]) return
    hand = nextHand
    selectedHands.add(hand)
    setPhase('waiting')
    renderKeyboard()
  }

  function roundMs(value) {
    return value == null || !Number.isFinite(value) ? null : Math.round(value)
  }

  function timingSummary(values) {
    var valid = values.filter(function (value) { return Number.isFinite(value) })
    if (!valid.length) return { minMs: null, averageMs: null, maxMs: null }
    var total = valid.reduce(function (sum, value) { return sum + value }, 0)
    return {
      minMs: Math.round(Math.min.apply(null, valid)),
      averageMs: Math.round(total / valid.length),
      maxMs: Math.round(Math.max.apply(null, valid)),
    }
  }

  function getSummary() {
    var placement = timingSummary(stats.placementTimes)
    var hold = timingSummary(stats.holdTimes)
    var mediaStandalone = false
    try {
      mediaStandalone = window.matchMedia('(display-mode: standalone)').matches
    } catch (_error) {
      mediaStandalone = false
    }

    return {
      environment: {
        userAgent: navigator.userAgent,
        navigatorStandalone: typeof navigator.standalone === 'boolean' ? navigator.standalone : null,
        displayModeStandalone: mediaStandalone,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        currentHand: hand,
        selectedHands: Array.from(selectedHands),
        dateTime: new Date().toISOString(),
      },
      counts: {
        successes: stats.successes,
        failures: stats.failures,
        simultaneous: stats.simultaneous,
        sequential: stats.sequential,
      },
      timings: {
        placementMs: placement,
        averageHoldMs: hold.averageMs,
      },
      contacts: {
        maxPointerContacts: stats.maxPointerContacts,
        maxTouchContacts: stats.maxTouchContacts,
        pointerCancelCount: stats.pointerCancelCount,
        touchCancelCount: stats.touchCancelCount,
        otherKeyContacts: stats.otherKeyContacts,
        outsideContacts: stats.outsideContacts,
        pointerTypes: Array.from(stats.pointerTypes).sort(),
      },
      trials: trials.map(function (trial) { return Object.assign({}, trial) }),
      recentEvents: events.map(function (event) { return Object.assign({}, event) }),
    }
  }

  function getState() {
    return {
      state: phase,
      phase: phase,
      hand: hand,
      requiredKeys: homeKeys[hand].slice(),
      pointerCount: activePointers.size,
      touchCount: lastTouchCount,
      activePointers: Array.from(activePointers.entries()).map(function (entry) {
        return { pointerId: entry[0], key: entry[1].key, pointerType: entry[1].pointerType }
      }),
      currentTrial: currentTrial ? trialRecord(currentTrial, phase === 'confirmed' || phase === 'releasing') : null,
      message: statusElement.textContent,
    }
  }

  function msText(value) {
    return value == null ? '--' : value + ' ms'
  }

  function handText(value) {
    return value === 'right' ? '右手' : '左手'
  }

  function formatSummary(summary) {
    var environment = summary.environment
    var counts = summary.counts
    var timings = summary.timings
    var contacts = summary.contacts
    var lines = [
      '【環境】',
      '日時: ' + environment.dateTime,
      'UA: ' + environment.userAgent,
      'navigator.standalone: ' + String(environment.navigatorStandalone),
      'display-mode standalone: ' + String(environment.displayModeStandalone),
      'maxTouchPoints: ' + environment.maxTouchPoints,
      '画面: ' + environment.viewport + ' / DPR ' + environment.devicePixelRatio,
      '手: 現在 ' + handText(environment.currentHand) + ' / 選択 ' + environment.selectedHands.map(handText).join('・'),
      '',
      '【結果】',
      '成功: ' + counts.successes + '回',
      '失敗（未成立）: ' + counts.failures + '回',
      '同時 / 順番: ' + counts.simultaneous + '回 / ' + counts.sequential + '回',
      '置くまで（最短 / 平均 / 最長）: ' +
        msText(timings.placementMs.minMs) + ' / ' + msText(timings.placementMs.averageMs) + ' / ' + msText(timings.placementMs.maxMs),
      '保持時間（平均）: ' + msText(timings.averageHoldMs),
      '',
      '【接触】',
      '最大同時接触数 Pointer / Touch: ' + contacts.maxPointerContacts + ' / ' + contacts.maxTouchContacts,
      'pointercancel / touchcancel: ' + contacts.pointerCancelCount + ' / ' + contacts.touchCancelCount,
      'ホーム以外のキー: ' + contacts.otherKeyContacts + '回',
      '鍵盤外: ' + contacts.outsideContacts + '回',
      'pointerType: ' + (contacts.pointerTypes.join(', ') || '--'),
      '',
      '【直近イベント（最新15件）】',
      '時刻          種別               pointerId  キー',
    ]

    summary.recentEvents.forEach(function (event) {
      lines.push(
        String(event.time).padEnd(13) + ' ' +
        String(event.type).padEnd(18) + ' ' +
        String(event.pointerId).padEnd(10) + ' ' +
        event.key,
      )
    })
    if (!summary.recentEvents.length) lines.push('（まだイベントはありません）')
    return lines.join('\n')
  }

  function showResults() {
    var text = formatSummary(getSummary())
    resultElement.textContent = text
    fallbackElement.value = text
    fallbackElement.hidden = true
    copyMessage.textContent = ''
    resultDialog.hidden = false
    document.getElementById('close-button').focus()
  }

  function hideResults() {
    resultDialog.hidden = true
    resultButton.focus()
  }

  function showCopyFallback(message) {
    fallbackElement.hidden = false
    fallbackElement.focus()
    fallbackElement.select()
    fallbackElement.setSelectionRange(0, fallbackElement.value.length)
    copyMessage.textContent = message
  }

  function copyResults() {
    var text = resultElement.textContent
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      showCopyFallback('自動コピーできません。選択した結果をコピーしてください。')
      return
    }

    navigator.clipboard.writeText(text).then(function () {
      copyMessage.textContent = 'コピーしました。会話に貼り付けてください。'
      fallbackElement.hidden = true
    }).catch(function () {
      showCopyFallback('自動コピーできません。選択した結果をコピーしてください。')
    })
  }

  function bindAction(button, action) {
    var lastPointerAction = -Infinity
    button.addEventListener('pointerup', function (event) {
      if (button.disabled) return
      event.preventDefault()
      lastPointerAction = performance.now()
      action()
    })
    button.addEventListener('click', function (event) {
      if (performance.now() - lastPointerAction < 500) return
      event.preventDefault()
      action()
    })
  }

  surface.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('pointerup', function (event) { onPointerFinish(event, false) })
  document.addEventListener('pointercancel', function (event) { onPointerFinish(event, true) })
  ;['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
    surface.addEventListener(type, onTouchEvent, { passive: false })
  })

  document.addEventListener('touchstart', function (event) { event.preventDefault() }, { passive: false })
  document.addEventListener('touchmove', function (event) { event.preventDefault() }, { passive: false })
  document.addEventListener('contextmenu', function (event) { event.preventDefault() })
  ;['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (event) { event.preventDefault() }, { passive: false })
  })

  document.querySelectorAll('.hand-button').forEach(function (button) {
    bindAction(button, function () { switchHand(button.dataset.hand) })
  })
  bindAction(resetButton, resetAll)
  bindAction(resultButton, showResults)
  bindAction(document.getElementById('close-button'), hideResults)
  bindAction(document.getElementById('copy-button'), copyResults)

  window.__touchTest = {
    getSummary: getSummary,
    getState: getState,
  }

  renderKeyboard()
  setPhase('waiting')
  updateCounts()
})()
