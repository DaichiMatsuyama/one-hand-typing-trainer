export function createPracticeSession(question, now = Date.now()) {
  if (typeof question !== 'string' || question.length === 0) {
    throw new Error('問題は1文字以上で指定してください。')
  }

  return {
    question: question.toLowerCase(),
    position: 0,
    attempts: 0,
    correctCount: 0,
    mistakes: 0,
    isComplete: false,
    isPaused: false,
    startedAt: now,
    elapsedMs: 0,
    feedback: null,
  }
}

export function submitKey(session, rawKey, now = Date.now()) {
  if (session.isComplete) return session

  const pressedKey = String(rawKey).toLowerCase()
  const expectedKey = session.question[session.position]
  const elapsedMs = getElapsedMs(session, now)

  if (pressedKey !== expectedKey) {
    return {
      ...session,
      attempts: session.attempts + 1,
      mistakes: session.mistakes + 1,
      elapsedMs,
      feedback: { type: 'incorrect', key: pressedKey },
    }
  }

  const position = session.position + 1
  return {
    ...session,
    position,
    attempts: session.attempts + 1,
    correctCount: session.correctCount + 1,
    isComplete: position === session.question.length,
    elapsedMs,
    feedback: { type: 'correct', key: pressedKey },
  }
}

export function updateElapsed(session, now = Date.now()) {
  if (session.isComplete) return session
  return { ...session, elapsedMs: getElapsedMs(session, now) }
}

export function getElapsedMs(session, now = Date.now()) {
  if (session.isComplete || session.isPaused) return session.elapsedMs
  return Math.max(session.elapsedMs, now - session.startedAt)
}

export function pausePracticeSession(session, now = Date.now()) {
  if (session.isComplete || session.isPaused) return session
  return {
    ...session,
    isPaused: true,
    elapsedMs: getElapsedMs(session, now),
  }
}

export function resumePracticeSession(session, now = Date.now()) {
  if (session.isComplete || !session.isPaused) return session
  return {
    ...session,
    isPaused: false,
    startedAt: now - session.elapsedMs,
  }
}

export function getAccuracy(session) {
  if (session.attempts === 0) return 100
  return Math.round((session.correctCount / session.attempts) * 100)
}

export function restorePracticeSession(savedSession, question, now = Date.now()) {
  if (!savedSession || savedSession.question !== question) return createPracticeSession(question, now)

  const elapsedMs = Number.isFinite(savedSession.elapsedMs) ? Math.max(0, savedSession.elapsedMs) : 0
  const savedPosition = Number.isSafeInteger(savedSession.position) && savedSession.position >= 0
    ? savedSession.position
    : 0
  const position = Math.min(savedPosition, question.length)
  const mistakes = Number.isSafeInteger(savedSession.mistakes) && savedSession.mistakes >= 0
    ? savedSession.mistakes
    : 0
  const correctCount = position
  return {
    ...createPracticeSession(question, now - elapsedMs),
    position,
    attempts: correctCount + mistakes,
    correctCount,
    mistakes,
    isComplete: position === question.length,
    isPaused: false,
    elapsedMs,
    feedback: null,
  }
}
