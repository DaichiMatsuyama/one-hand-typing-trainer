// ホームポジション確認: 問題をクリアするたびに、ホームの4キーへ指を置き直したことを確認する。
// 対象の4キー・案内文・runごとの集計をここへ集め、画面とエンジンで同じ定義を使う。

export const HOME_POSITION_KEYS = Object.freeze({
  left: Object.freeze(['a', 's', 'd', 'f']),
  right: Object.freeze(['j', 'k', 'l', ';']),
})

// GASの検証(hpAvgReturnMs / hpMinReturnMsの上限)と同じ値
export const MAX_RETURN_MS = 86_400_000

export function getHomePositionKeys(hand) {
  return [...(HOME_POSITION_KEYS[hand] ?? HOME_POSITION_KEYS.left)]
}

// 「A S D F」「J K L ;」のように、案内文へ入れる表記
export function formatHomePositionKeys(hand) {
  return getHomePositionKeys(hand).map((key) => key.toUpperCase()).join(' ')
}

export function describeHomePositionGuide(hand, established) {
  return established
    ? '確認できました。指を離すと次へ進みます'
    : `${formatHomePositionKeys(hand)} に指を置いてください`
}

// 読み上げ用。確認の開始時だけ「ホームポジション確認。」を前置きする。
export function describeHomePositionAnnouncement(hand, established) {
  return established
    ? describeHomePositionGuide(hand, true)
    : `ホームポジション確認。${describeHomePositionGuide(hand, false)}`
}

export function createHomePositionStats() {
  return { successCount: 0, skipCount: 0, returnMsTotal: 0, minReturnMs: null }
}

export function recordHomePositionSuccess(stats, returnMs) {
  const value = Math.min(MAX_RETURN_MS, Math.max(0, Math.round(Number(returnMs) || 0)))
  return {
    ...stats,
    successCount: stats.successCount + 1,
    returnMsTotal: stats.returnMsTotal + value,
    minReturnMs: stats.minReturnMs === null ? value : Math.min(stats.minReturnMs, value),
  }
}

export function recordHomePositionSkip(stats) {
  return { ...stats, skipCount: stats.skipCount + 1 }
}

/**
 * runの設定値と集計から、結果・履歴・送信に使う項目を作る。
 * 確認なし(OFF)のrunは、回数0・時間nullに固定する。成功が0回なら平均・最短はnull。
 */
export function summarizeHomePosition(enabled, stats) {
  if (!enabled || !stats) {
    return { homePosition: false, hpSuccessCount: 0, hpSkipCount: 0, hpAvgReturnMs: null, hpMinReturnMs: null }
  }
  return {
    homePosition: true,
    hpSuccessCount: stats.successCount,
    hpSkipCount: stats.skipCount,
    hpAvgReturnMs: stats.successCount === 0
      ? null
      : Math.round(stats.returnMsTotal / stats.successCount),
    hpMinReturnMs: stats.successCount === 0 ? null : stats.minReturnMs,
  }
}

// 結果画面用: 1000msを「1.2秒」のように小数1桁で出す。ない値は「-」
export function formatReturnSeconds(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  return `${(Math.round(ms / 100) / 10).toFixed(1)}秒`
}
