import { getLayoutPitchCount } from './data/keyboardLayouts.js'

export const LANDSCAPE_LAYOUT = Object.freeze({
  infoStripHeight: 48,
  layoutGap: 2,
  infoStripBorderInline: 2,
  keyboardPanelBorderBlock: 2,
  keyboardPanelBorderInline: 2,
  // キーボードの外側の縁(左手は左、右手は右)と枠との間の余白。キーの大きさは変えず、幅の計算にだけ含める。
  // 幅の狭い画面では、凡例の幅を守るため余白を小さくする。
  keyboardPanelPaddingInline: 12,
  keyboardPanelPaddingInlineNarrow: 4,
  narrowViewportMax: 760,
  keyShadowDepth: 4,
  keyPitchMin: 49,
  keyPitchMax: 115,
  keyGapMin: 4,
  keyGapRatio: 0.065,
  keyGapMax: 8,
  shellInlineMin: 6,
  shellBlockMin: 5,
  legendMinimumWidth: 52,
  // 設定操作を別画面へ移し、情報帯は問題・累計・やり直す・メニューで構成する。
  stripPromptMinimumWidth: 186,
  stripStatsWidth: 182,
  stripCompactStatsWidth: 112,
  stripActionWidth: 50,
  stripMenuWidth: 66,
  stripGridGap: 3,
  stripInlinePadding: 2,
  stripResultGap: 3,
  stripCompactGridGap: 2,
  stripCompactInlinePadding: 1,
  stripCompactResultGap: 1,
  compactBreakpoint: 732,
  promptFutureFontSize: 20,
  promptCurrentFontSizeMax: 32,
  promptMonospaceAdvanceRatio: 0.62,
  promptCharacterGap: 1.2,
  promptFingerHintWidth: 40,
  promptContentGap: 4,
})

function clamp(minimum, value, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function estimatePromptWidth(characterCount = 10) {
  const config = LANDSCAPE_LAYOUT
  const remainingCount = Math.max(0, characterCount - 1)
  const questionWidth = config.promptCurrentFontSizeMax * config.promptMonospaceAdvanceRatio
    + remainingCount * config.promptFutureFontSize * config.promptMonospaceAdvanceRatio
    + remainingCount * config.promptCharacterGap
  return {
    questionWidth,
    withFingerHint: questionWidth
      + config.promptContentGap
      + config.promptFingerHintWidth,
  }
}

/**
 * 上部情報ストリップ型の横画面レイアウトを数値化する。
 * 単位はCSS px（iPhoneではpt相当）。
 */
export function calculateLandscapeLayout({
  width,
  height,
  safeArea = {},
  hand = 'left',
  layoutVariant = 'jis',
}) {
  const safe = {
    top: safeArea.top ?? 0,
    right: safeArea.right ?? 0,
    bottom: safeArea.bottom ?? 0,
    left: safeArea.left ?? 0,
  }
  const config = LANDSCAPE_LAYOUT
  const padding = {
    top: Math.max(config.shellBlockMin, safe.top),
    right: Math.max(config.shellInlineMin, safe.right),
    bottom: Math.max(config.shellBlockMin, safe.bottom),
    left: Math.max(config.shellInlineMin, safe.left),
  }
  const availableWidth = width - padding.left - padding.right
  const availableHeight = height - padding.top - padding.bottom
  const keyboardAreaHeight = availableHeight - config.infoStripHeight - config.layoutGap
  const keyboardContentHeight = keyboardAreaHeight - config.keyboardPanelBorderBlock
  const keyboardHeightBudget = keyboardContentHeight - config.keyShadowDepth
  const keyboardPitchCount = getLayoutPitchCount(hand, layoutVariant)
  // キーボードの幅 = 個数 × pitch - gap(gap ≒ pitch × 比率)。枠の線と、外側の縁の余白を除いた幅に収める。
  const panelPadding = width <= config.narrowViewportMax
    ? config.keyboardPanelPaddingInlineNarrow
    : config.keyboardPanelPaddingInline
  const keyboardInnerWidth = availableWidth
    - config.keyboardPanelBorderInline
    - panelPadding
  const widthPitch = keyboardInnerWidth / (keyboardPitchCount - config.keyGapRatio)
  const heightPitch = keyboardHeightBudget / 3
  const keyPitch = clamp(
    config.keyPitchMin,
    Math.min(widthPitch, heightPitch),
    config.keyPitchMax,
  )
  const keyGap = clamp(
    config.keyGapMin,
    keyPitch * config.keyGapRatio,
    config.keyGapMax,
  )
  const keySize = keyPitch - keyGap
  const keyboardWidth = keyboardPitchCount * keyPitch - keyGap
  const keyboardHeight = 3 * keyPitch - keyGap
  const keyboardVisualHeight = keyboardHeight + config.keyShadowDepth
  const legendWidth = hand === 'right'
    ? 0.75 * keyPitch - keyGap
    : keyboardInnerWidth - keyboardWidth
  const stripClientWidth = availableWidth - config.infoStripBorderInline
  const isCompact = availableWidth <= config.compactBreakpoint
  const statsWidth = isCompact
    ? config.stripCompactStatsWidth
    : config.stripStatsWidth
  const gridGap = isCompact ? config.stripCompactGridGap : config.stripGridGap
  const inlinePadding = isCompact
    ? config.stripCompactInlinePadding
    : config.stripInlinePadding
  const resultGap = isCompact
    ? config.stripCompactResultGap
    : config.stripResultGap
  const gapsAndPadding = 2 * gridGap + 2 * inlinePadding
  const normalResultWidth = statsWidth + resultGap + config.stripActionWidth
  const normalStripWidth = config.stripPromptMinimumWidth
    + normalResultWidth
    + config.stripMenuWidth
    + gapsAndPadding
  const completeStripWidth = normalStripWidth
  const requiredStripWidth = normalStripWidth
  const promptAvailableWidth = availableWidth
    - config.infoStripBorderInline
    - normalResultWidth
    - config.stripMenuWidth
    - gapsAndPadding

  return {
    width,
    height,
    safeArea: safe,
    padding,
    availableWidth,
    availableHeight,
    keyboardAreaHeight,
    keyboardContentHeight,
    keyboardHeightBudget,
    keyboardPitchCount,
    widthPitch,
    heightPitch,
    keyPitch,
    keyGap,
    keySize,
    keyboardWidth,
    keyboardHeight,
    keyboardVisualHeight,
    legendWidth,
    stripClientWidth,
    isCompact,
    normalStripWidth,
    completeStripWidth,
    requiredStripWidth,
    promptAvailableWidth,
    stripFits: requiredStripWidth <= stripClientWidth,
    legendFits: legendWidth >= config.legendMinimumWidth,
    noHorizontalScroll: keyboardWidth <= availableWidth
      && requiredStripWidth <= stripClientWidth,
    noVerticalScroll: keyboardVisualHeight <= keyboardContentHeight,
    hasMinimumTapTarget: keySize >= 44,
  }
}
