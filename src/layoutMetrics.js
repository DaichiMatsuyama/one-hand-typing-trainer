export const LANDSCAPE_LAYOUT = Object.freeze({
  infoStripHeight: 48,
  layoutGap: 2,
  keyboardPitchCount: 5.75,
  keyPitchMin: 49,
  keyPitchMax: 115,
  keyGapMin: 4,
  keyGapRatio: 0.065,
  keyGapMax: 8,
  shellInlineMin: 6,
  shellBlockMin: 5,
  legendMinimumWidth: 52,
  stripControlsWidth: 274,
  stripPromptMinimumWidth: 186,
  stripResultWidth: 171,
  stripCompleteResultWidth: 243,
  stripCompactCompleteResultWidth: 108,
  stripGapsAndChrome: 16,
  compactBreakpoint: 700,
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
export function calculateLandscapeLayout({ width, height, safeArea = {} }) {
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
  const widthPitch = availableWidth / config.keyboardPitchCount
  const heightPitch = keyboardAreaHeight / 3
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
  const keyboardWidth = config.keyboardPitchCount * keyPitch - keyGap
  const keyboardHeight = 3 * keyPitch - keyGap
  const legendWidth = availableWidth - keyboardWidth
  const normalStripWidth = config.stripControlsWidth
    + config.stripPromptMinimumWidth
    + config.stripResultWidth
    + config.stripGapsAndChrome
  const completeResultWidth = width <= config.compactBreakpoint
    ? config.stripCompactCompleteResultWidth
    : config.stripCompleteResultWidth
  const completeStripWidth = config.stripControlsWidth
    + config.stripPromptMinimumWidth
    + completeResultWidth
    + config.stripGapsAndChrome
  const requiredStripWidth = Math.max(normalStripWidth, completeStripWidth)
  const promptAvailableWidth = availableWidth
    - config.stripControlsWidth
    - config.stripResultWidth
    - config.stripGapsAndChrome

  return {
    width,
    height,
    safeArea: safe,
    padding,
    availableWidth,
    availableHeight,
    keyboardAreaHeight,
    widthPitch,
    heightPitch,
    keyPitch,
    keyGap,
    keySize,
    keyboardWidth,
    keyboardHeight,
    legendWidth,
    requiredStripWidth,
    promptAvailableWidth,
    stripFits: requiredStripWidth <= availableWidth,
    legendFits: legendWidth >= config.legendMinimumWidth,
    noHorizontalScroll: keyboardWidth <= availableWidth
      && requiredStripWidth <= availableWidth,
    noVerticalScroll: keyboardHeight <= keyboardAreaHeight,
    hasMinimumTapTarget: keySize >= 44,
  }
}
