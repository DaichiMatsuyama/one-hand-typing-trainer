export const RANK_VERSION = 1

// ランク基準はここだけを変更すればよい形にまとめる。
const RANK_CONFIG = Object.freeze({
  S: Object.freeze({ kpm: 120, mistakes: 0, correctCount: 50 }),
  A: Object.freeze({ kpm: 100, accuracy: 97 }),
  B: Object.freeze({ kpm: 80, accuracy: 93 }),
  C: Object.freeze({ kpm: 60, accuracy: 88 }),
  D: Object.freeze({ kpm: 40, accuracy: 80 }),
  E: Object.freeze({ kpm: 20, accuracy: 70 }),
  F: Object.freeze({}),
})

export const RANK_ORDER = Object.freeze(['S', 'A', 'B', 'C', 'D', 'E', 'F'])

// 将来レベル別補正を入れる入口。現時点では全レベルで同じ基準を使う。
export function getRankTable(_level) {
  return RANK_CONFIG
}

export function evaluateRank({ kpm, correctCount = 0, mistakes = 0, accuracy = 0, level } = {}) {
  if (kpm === null || !Number.isFinite(kpm)) return null
  const table = getRankTable(level)
  if (kpm >= table.S.kpm && mistakes === table.S.mistakes && correctCount >= table.S.correctCount) return 'S'
  for (const rank of ['A', 'B', 'C', 'D', 'E']) {
    if (kpm >= table[rank].kpm && accuracy >= table[rank].accuracy) return rank
  }
  return 'F'
}

export function getRankScore(rank) {
  const index = RANK_ORDER.indexOf(rank)
  return index === -1 ? -1 : RANK_ORDER.length - index
}

export function describeNextRank(result = {}) {
  const rank = result.rank ?? evaluateRank(result)
  if (!rank) return null
  if (rank === 'S') {
    return { targetRank: null, requirements: [], text: '最高ランク' }
  }

  const targetRank = RANK_ORDER[RANK_ORDER.indexOf(rank) - 1]
  const target = getRankTable(result.level)[targetRank]
  const requirements = []
  if ((result.kpm ?? 0) < target.kpm) {
    requirements.push(`KPMあと${Math.ceil(target.kpm - (result.kpm ?? 0))}`)
  }
  if (targetRank === 'S') {
    if (result.mistakes !== 0) requirements.push('ノーミス')
    if ((result.correctCount ?? 0) < target.correctCount) {
      requirements.push(`正しい入力あと${target.correctCount - (result.correctCount ?? 0)}回`)
    }
  } else if ((result.accuracy ?? 0) < target.accuracy) {
    requirements.push(`正解率あと${target.accuracy - (result.accuracy ?? 0)}%`)
  }

  return {
    targetRank,
    requirements,
    text: requirements.length > 0
      ? `${targetRank}ランクまで ${requirements.join('・')}`
      : `${targetRank}ランクの条件を達成しています`,
  }
}
