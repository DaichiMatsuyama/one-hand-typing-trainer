export const LANDSCAPE_LAYOUT = Object.freeze({
  infoStripHeight: 48,
  layoutGap: 2,
  infoStripBorderInline: 2,
  keyboardPanelBorderBlock: 2,
  keyShadowDepth: 4,
  keyboardPitchCount: 5.75,
  keyPitchMin: 49,
  keyPitchMax: 115,
  keyGapMin: 4,
  keyGapRatio: 0.065,
  keyGapMax: 8,
  shellInlineMin: 6,
  shellBlockMin: 5,
  legendMinimumWidth: 52,
  // 667px幅の実DOMで、左手時の操作部は約288px、成績4項目は約182pxだった。
  // ボタンは日本語ラベルを含めて50pxを確保し、CSSでも同じ固定値を使用する。
  stripControlsWidth: 288,
  stripCompactControlsWidth: 272,
  stripPromptMinimumWidth: 186,
  stripCompletePromptMinimumWidth: 143,
  stripStatsWidth: 182,
  stripCompactStatsWidth: 112,
  stripActionWidth: 50,
  stripGridGap: 3,
  stripInlinePadding: 2,
  stripResultGap: 3,
  stripActionGap: 3,
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
  const keyboardContentHeight = keyboardAreaHeight - config.keyboardPanelBorderBlock
  const keyboardHeightBudget = keyboardContentHeight - config.keyShadowDepth
  const widthPitch = availableWidth / config.keyboardPitchCount
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
  const keyboardWidth = config.keyboardPitchCount * keyPitch - keyGap
  const keyboardHeight = 3 * keyPitch - keyGap
  const keyboardVisualHeight = keyboardHeight + config.keyShadowDepth
  const legendWidth = availableWidth - keyboardWidth
  const stripClientWidth = availableWidth - config.infoStripBorderInline
  const isCompact = availableWidth <= config.compactBreakpoint
  const controlsWidth = isCompact
    ? config.stripCompactControlsWidth
    : config.stripControlsWidth
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
  const completeResultWidth = isCompact
    ? 2 * config.stripActionWidth + config.stripActionGap
    : statsWidth + resultGap + 2 * config.stripActionWidth + config.stripActionGap
  const normalStripWidth = controlsWidth
    + config.stripPromptMinimumWidth
    + normalResultWidth
    + gapsAndPadding
  const completeStripWidth = controlsWidth
    + config.stripCompletePromptMinimumWidth
    + completeResultWidth
    + gapsAndPadding
  const requiredStripWidth = Math.max(normalStripWidth, completeStripWidth)
  const promptAvailableWidth = availableWidth
    - config.infoStripBorderInline
    - controlsWidth
    - normalResultWidth
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
