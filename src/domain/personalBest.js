import { evaluateRank, getRankScore } from './rank.js'

export const CONDITION_FIELDS = Object.freeze([
  'mode', 'hand', 'level', 'targetCount', 'timeLimitSec',
  'homePosition', 'includeSymbols', 'layout',
])

export function hasSameConditions(left, right) {
  return CONDITION_FIELDS.every((field) => left?.[field] === right?.[field])
}

export function isBestCandidate(record) {
  return record?.endedBy !== 'ended'
    && record?.menuOpenCount === 0
    && record?.kpm !== null
    && Number.isFinite(record?.kpm)
}

export function comparePerformance(left, right) {
  const rankDifference = getRankScore(evaluateRank(left)) - getRankScore(evaluateRank(right))
  if (rankDifference !== 0) return rankDifference
  return (left?.kpm ?? -1) - (right?.kpm ?? -1)
}

export function analyzePersonalBest(current, history) {
  if (current?.endedBy === 'ended') {
    return { eligible: false, isFirst: false, isNewBest: false, reason: 'ended', previousBest: null }
  }
  if ((current?.menuOpenCount ?? 0) > 0) {
    return { eligible: false, isFirst: false, isNewBest: false, reason: 'menu', previousBest: null }
  }
  if (current?.kpm === null || !Number.isFinite(current?.kpm)) {
    return { eligible: false, isFirst: false, isNewBest: false, reason: 'noKpm', previousBest: null }
  }

  const candidates = history.filter((record) => hasSameConditions(current, record) && isBestCandidate(record))
  const previousBest = candidates.reduce((best, record) => (
    !best || comparePerformance(record, best) > 0 ? record : best
  ), null)
  if (!previousBest) {
    return { eligible: true, isFirst: true, isNewBest: false, reason: null, previousBest: null }
  }
  return {
    eligible: true,
    isFirst: false,
    isNewBest: comparePerformance(current, previousBest) > 0,
    reason: null,
    previousBest,
  }
}

export function findPreviousCompleted(current, history) {
  return history.find((record) => (
    hasSameConditions(current, record)
      && (current?.mode === 'free' ? record?.endedBy === 'ended' : record?.endedBy !== 'ended')
  )) ?? null
}

export function analyzeGrowth(current, history) {
  const previous = findPreviousCompleted(current, history)
  if (!previous) return { previous: null, improvements: [] }
  const improvements = []
  if (current.kpm !== null && previous.kpm !== null && current.kpm > previous.kpm) {
    improvements.push({ type: 'kpm', amount: current.kpm - previous.kpm, text: `入力速度が前回より+${current.kpm - previous.kpm} KPM` })
  }
  if (current.accuracy > previous.accuracy) {
    improvements.push({ type: 'accuracy', amount: current.accuracy - previous.accuracy, text: `正解率が前回より+${current.accuracy - previous.accuracy}%` })
  }
  if (current.mistakes < previous.mistakes) {
    improvements.push({ type: 'mistakes', amount: previous.mistakes - current.mistakes, text: `ミスが${previous.mistakes - current.mistakes}回減りました` })
  }
  return { previous, improvements }
}
