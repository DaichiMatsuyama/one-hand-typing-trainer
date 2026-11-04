import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  LANDSCAPE_LAYOUT,
  calculateLandscapeLayout,
  estimatePromptWidth,
} from './layoutMetrics.js'
import { getLayoutPitchCount } from './data/keyboardLayouts.js'

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8'),
)

function cssPxVariable(name) {
  const match = styles.match(new RegExp(`--${name}:\\s*([0-9.]+)px`))
  if (!match) throw new Error(`CSS変数 --${name} が見つかりません`)
  return Number(match[1])
}

function cssNumber(pattern, label) {
  const match = styles.match(pattern)
  if (!match) throw new Error(`${label} がCSSから読み取れません`)
  return Number(match[1])
}

function readGeneratedPngPixels(buffer) {
  const idatChunks = []
  let offset = 8
  let width
  let height
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    }
    if (type === 'IDAT') idatChunks.push(data)
    offset += length + 12
  }
  return { width, height, pixels: inflateSync(Buffer.concat(idatChunks)) }
}

function contrastRatio(foreground, background) {
  const luminance = (color) => {
    const channels = color.match(/[0-9a-f]{2}/gi)
      .map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => (value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4))
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('実機向けレイアウト', () => {
  it('CSSで実際に使う固定値をlayoutMetrics.jsと一致させる', () => {
    const cssValues = {
      infoStripHeight: cssPxVariable('info-strip-height'),
      layoutGap: cssPxVariable('layout-gap'),
      infoStripBorderInline: cssPxVariable('info-strip-border-inline'),
      keyboardPanelBorderBlock: cssPxVariable('keyboard-panel-border-block'),
      keyboardPanelBorderInline: cssPxVariable('keyboard-panel-border-inline'),
      keyboardPanelPaddingInline: cssPxVariable('keyboard-panel-padding-inline'),
      keyboardPanelPaddingInlineNarrow: cssPxVariable('keyboard-panel-padding-inline-narrow'),
      narrowViewportMax: cssNumber(
        /@media\s*\(max-width:\s*([0-9.]+)px\)\s*\{\s*\.app-shell\s*\{\s*--keyboard-panel-padding-inline/,
        '余白を小さくする画面幅',
      ),
      keyShadowDepth: cssPxVariable('key-shadow-depth'),
      keyPitchMin: cssPxVariable('key-pitch-min'),
      keyPitchMax: cssPxVariable('key-pitch-max'),
      keyGapMin: cssPxVariable('key-gap-min'),
      keyGapMax: cssPxVariable('key-gap-max'),
      shellInlineMin: cssPxVariable('shell-inline-min'),
      shellBlockMin: cssPxVariable('shell-block-min'),
      stripPromptMinimumWidth: cssPxVariable('strip-prompt-min'),
      stripStatsWidth: cssPxVariable('strip-stats-width'),
      stripCompactStatsWidth: cssPxVariable('strip-compact-stats-width'),
      stripModeStatsWidth: cssPxVariable('strip-mode-stats-width'),
      stripActionWidth: cssPxVariable('strip-action-width'),
      stripMenuWidth: cssPxVariable('strip-menu-width'),
      stripGridGap: cssPxVariable('strip-grid-gap'),
      stripInlinePadding: cssPxVariable('strip-inline-padding'),
      stripResultGap: cssPxVariable('strip-result-gap'),
      stripCompactGridGap: cssPxVariable('strip-compact-grid-gap'),
      stripCompactInlinePadding: cssPxVariable('strip-compact-inline-padding'),
      stripCompactResultGap: cssPxVariable('strip-compact-result-gap'),
      compactBreakpoint: cssNumber(
        /@container\s+practice\s*\(max-width:\s*([0-9.]+)px\)/,
        'コンパクト表示の境界',
      ),
      keyGapRatio: cssNumber(
        /calc\(var\(--key-pitch\)\s*\*\s*([0-9.]+)\)/,
        'キー間隔の比率',
      ),
    }

    expect(cssValues).toEqual(Object.fromEntries(
      Object.keys(cssValues).map((key) => [key, LANDSCAPE_LAYOUT[key]]),
    ))
    expect(cssNumber(/--keyboard-pitch-count:\s*([0-9.]+)/, '既定のキーピッチ数')).toBe(
      getLayoutPitchCount('left', 'jis'),
    )
    // 幅基準の式: (幅 - 枠の線 - 外側の余白) / (列数 - gapの比率)
    expect(styles).toContain('- var(--keyboard-panel-border-inline) - var(--keyboard-panel-padding-inline))')
    expect(styles).toContain('/ (var(--keyboard-pitch-count) - 0.065)')
    expect(styles).toContain('var(--key-pitch) * var(--keyboard-pitch-count)')
    expect(styles).toContain('minmax(var(--strip-prompt-min), 1fr)')
    expect(styles).toMatch(/\.prompt-card\.complete\s*\{\s*gap:\s*0/)
    expect(styles).toContain('width: var(--strip-stats-width)')
    expect(styles).toContain('width: var(--strip-mode-stats-width)')
    expect(styles).toContain('width: var(--strip-action-width)')
    expect(styles).toContain('width: var(--strip-menu-width)')
    expect(styles).toContain('- var(--keyboard-panel-border-block) - var(--key-shadow-depth)) / 3')
    expect(styles).toContain('0 var(--key-shadow-depth) 0')
    expect(styles).toMatch(/\.info-strip\s*\{[\s\S]*?border:\s*1px solid/)
    expect(styles).toMatch(/\.keyboard-panel\s*\{[\s\S]*?border:\s*1px solid/)
    expect(cssPxVariable('info-strip-border-inline')).toBe(2 * 1)
    expect(cssPxVariable('keyboard-panel-border-block')).toBe(2 * 1)
  })

  it('情報ストリップを常に上部、キーボードを残りの領域に配置する', () => {
    expect(styles).toMatch(/grid-template-areas:\s*"strip"\s*"keyboard"/)
    expect(styles).not.toContain('grid-template-areas: "keyboard info"')
    expect(styles).toContain('container-name: practice')
    expect(styles).toContain('container-type: inline-size')
  })

  const landscapeCases = [
    ['iPhone SE系', 667, 375, { left: 0, right: 0, bottom: 0 }],
    ['Dynamic Island搭載機', 852, 393, { left: 59, right: 59, bottom: 21 }],
    ['874x402', 874, 402, { left: 44, right: 44, bottom: 21 }],
    ['932x430', 932, 430, { left: 59, right: 59, bottom: 21 }],
  ]

  it.each(landscapeCases)(
    '%s（%dx%d）でストリップ・キー・凡例が収まり、44px以上のタップ領域になる',
    (_name, width, height, safeArea) => {
      const metrics = calculateLandscapeLayout({ width, height, safeArea })
      expect(metrics.keyPitch).toBeLessThanOrEqual(LANDSCAPE_LAYOUT.keyPitchMax)
      expect(metrics.normalStripWidth).toBeLessThanOrEqual(metrics.stripClientWidth)
      expect(metrics.completeStripWidth).toBeLessThanOrEqual(metrics.stripClientWidth)
      expect(metrics.stripFits).toBe(true)
      expect(metrics.legendFits).toBe(true)
      expect(metrics.noHorizontalScroll).toBe(true)
      expect(metrics.noVerticalScroll).toBe(true)
      expect(metrics.hasMinimumTapTarget).toBe(true)
      expect(estimatePromptWidth(10).withFingerHint).toBeLessThanOrEqual(
        metrics.promptAvailableWidth,
      )
    },
  )

  it('667x375はclientWidth 653px相当のコンパクト表示で通常・クリア状態とも収まる', () => {
    const metrics = calculateLandscapeLayout({ width: 667, height: 375 })

    expect(metrics.availableWidth).toBe(655)
    expect(metrics.stripClientWidth).toBe(653)
    expect(metrics.isCompact).toBe(true)
    expect(metrics.normalStripWidth).toBe(421)
    expect(metrics.modeStripWidth).toBe(474)
    expect(metrics.completeStripWidth).toBe(421)
    expect(metrics.requiredStripWidth).toBeLessThanOrEqual(metrics.stripClientWidth)
    expect(styles).toMatch(/@container\s+practice[\s\S]*?\.stats div:last-child\s*\{\s*display:\s*none/)
    expect(styles).toMatch(/\.result-bar\.no-reset \.stats div:last-child\s*\{\s*display:\s*block/)
    expect(styles).not.toMatch(/\.result-bar\.complete \.stats\s*\{\s*display:\s*none/)
  })

  it.each([
    ['667x375', 667, 375, {}],
    ['852x393 safe-areaあり', 852, 393, { left: 59, right: 59, bottom: 21 }],
  ])('%sでJIS右手6.75ピッチが収まり、凡例を下段の空きへ置ける', (_name, width, height, safeArea) => {
    const metrics = calculateLandscapeLayout({
      width,
      height,
      safeArea,
      hand: 'right',
      layoutVariant: 'jis',
    })

    expect(metrics.keyboardPitchCount).toBe(6.75)
    const padding = width <= LANDSCAPE_LAYOUT.narrowViewportMax
      ? LANDSCAPE_LAYOUT.keyboardPanelPaddingInlineNarrow
      : LANDSCAPE_LAYOUT.keyboardPanelPaddingInline
    expect(metrics.widthPitch).toBeCloseTo((metrics.availableWidth - 2 - padding) / (6.75 - 0.065), 5)
    expect(metrics.keyboardWidth).toBeLessThanOrEqual(metrics.availableWidth)
    expect(metrics.legendFits).toBe(true)
    expect(metrics.noHorizontalScroll).toBe(true)
    expect(metrics.hasMinimumTapTarget).toBe(true)
  })

  it.each(['left', 'right'])('852x393(iPhone 16)の%s手: キーの大きさは余白をつける前と同じで、外側の縁に12px以上の余白がある', (hand) => {
    const metrics = calculateLandscapeLayout({
      width: 852,
      height: 393,
      safeArea: { left: 59, right: 59, bottom: 21 },
      hand,
    })
    // 高さ基準が先に上限になるため、幅の余白を足してもキーは縮まない(余白をつける前と同じ103.67)
    expect(metrics.keyPitch).toBeCloseTo(103.67, 2)
    expect(metrics.heightPitch).toBeLessThanOrEqual(metrics.widthPitch)
    // 枠の内側の幅(734 - 線2px)から、キーボードの幅を引いた余りが、外側の余白12px以上
    const slack = metrics.availableWidth - 2 - metrics.keyboardWidth
    expect(slack).toBeGreaterThanOrEqual(LANDSCAPE_LAYOUT.keyboardPanelPaddingInline)
  })

  it('幅の狭い画面(667pt)では余白を4pxに抑え、左手の凡例の幅を守る', () => {
    const metrics = calculateLandscapeLayout({ width: 667, height: 375, hand: 'left' })
    expect(metrics.legendFits).toBe(true)
    expect(metrics.legendWidth).toBeGreaterThanOrEqual(LANDSCAPE_LAYOUT.legendMinimumWidth)
  })

  it('左手とUS右手は5.75ピッチのままにする', () => {
    expect(calculateLandscapeLayout({ width: 667, height: 375, hand: 'left' }).keyboardPitchCount).toBe(5.75)
    expect(calculateLandscapeLayout({
      width: 667,
      height: 375,
      hand: 'right',
      layoutVariant: 'us',
    }).keyboardPitchCount).toBe(5.75)
    expect(styles).toMatch(/\.finger-legend-embedded\s*\{[\s\S]*?left:\s*0[\s\S]*?width:\s*calc\(\(var\(--key-pitch\) \* 0\.75\)/)
  })

  it('852x393とsafe-area左右59・下21では通常表示を保ち、影まで高さ内に収める', () => {
    const metrics = calculateLandscapeLayout({
      width: 852,
      height: 393,
      safeArea: { left: 59, right: 59, bottom: 21 },
    })

    expect(metrics.availableWidth).toBe(734)
    expect(metrics.stripClientWidth).toBe(732)
    expect(metrics.isCompact).toBe(false)
    expect(metrics.availableHeight).toBe(367)
    expect(metrics.keyboardAreaHeight).toBe(317)
    expect(metrics.keyboardContentHeight).toBe(315)
    expect(metrics.keyboardHeightBudget).toBe(311)
    expect(metrics.heightPitch).toBeCloseTo(103.67, 2)
    expect(metrics.widthPitch).toBeCloseTo(((734 - 2 - 12) / (5.75 - 0.065)), 2)
    expect(metrics.keyboardPitchCount).toBe(5.75)
    expect(metrics.keyPitch).toBeCloseTo(103.67, 2)
    expect(metrics.keySize).toBeCloseTo(96.93, 2)
    expect(metrics.keyboardVisualHeight).toBeLessThanOrEqual(metrics.keyboardContentHeight)
    expect(metrics.legendWidth).toBeGreaterThanOrEqual(LANDSCAPE_LAYOUT.legendMinimumWidth)
  })

  it.each(landscapeCases)(
    '%sのSafariタブ相当の低い表示領域でも収まる',
    (_name, width, height, safeArea) => {
      const metrics = calculateLandscapeLayout({ width, height: height - 50, safeArea })
      expect(metrics.stripFits).toBe(true)
      expect(metrics.noHorizontalScroll).toBe(true)
      expect(metrics.noVerticalScroll).toBe(true)
      expect(metrics.hasMinimumTapTarget).toBe(true)
    },
  )

  it('Lv.3の10文字でも中央の最小幅へ収まる文字サイズにする', () => {
    const promptWidth = estimatePromptWidth(10)
    expect(promptWidth.questionWidth).toBeCloseTo(142.24, 2)
    expect(promptWidth.withFingerHint).toBeCloseTo(186.24, 2)
    expect(styles).toMatch(/\.prompt-text \{[\s\S]*font-size:\s*20px/)
    expect(styles).toMatch(/\.prompt-text \{[\s\S]*white-space:\s*nowrap/)
    expect(styles).toMatch(/\.prompt-text \.current \{[\s\S]*font-size:\s*clamp\(1\.7rem/)
    expect(contrastRatio('303946', 'fffdf8')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('657080', 'fffdf8')).toBeGreaterThanOrEqual(4.5)
  })

  it('reduced motionでも正誤を約450ms保持する背景色で示す', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.key\.correct[\s\S]*?background:\s*#62cf9f[\s\S]*?animation:\s*none/)
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.key\.incorrect[\s\S]*?background:\s*#ff9fa7[\s\S]*?animation:\s*none/)
  })
})

describe('ホーム画面用アセット', () => {
  it('明るいテーマと整合するデフォルトのiOSステータスバーを使う', () => {
    expect(indexHtml).toContain('<meta name="theme-color" content="#f7f3ea" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />')
    expect(manifest.theme_color).toBe('#f7f3ea')
    expect(manifest.background_color).toBe('#f7f3ea')
  })

  it('GitHub Pagesのbaseから解決できる相対manifestと用途別アイコンを持つ', () => {
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.display).toBe('standalone')
    expect(manifest.orientation).toBe('landscape')
    expect(manifest.icons.map(({ src, purpose }) => ({ src, purpose }))).toEqual([
      { src: 'icons/icon-180.png', purpose: 'any' },
      { src: 'icons/icon-512.png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', purpose: 'maskable' },
    ])
  })

  it.each([
    ['icon-180.png', 180],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
  ])('%sが正しい寸法のPNGとして存在する', (filename, size) => {
    const icon = readFileSync(resolve(process.cwd(), `public/icons/${filename}`))
    expect([...icon.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(icon.readUInt32BE(16)).toBe(size)
    expect(icon.readUInt32BE(20)).toBe(size)
  })

  it('maskable用は通常用と異なる安全領域向け画像にする', () => {
    const regular = readFileSync(resolve(process.cwd(), 'public/icons/icon-512.png'))
    const maskable = readFileSync(resolve(process.cwd(), 'public/icons/icon-maskable-512.png'))
    expect(maskable.equals(regular)).toBe(false)
  })

  it('maskable用のキー外形を中央80%の安全円内に収める', () => {
    const icon = readFileSync(resolve(process.cwd(), 'public/icons/icon-maskable-512.png'))
    const { width, height, pixels } = readGeneratedPngPixels(icon)
    const stride = width * 4 + 1
    const center = (width - 1) / 2
    const safeRadius = width * 0.4
    let maximumDistance = 0

    for (let y = 0; y < height; y += 1) {
      expect(pixels[y * stride]).toBe(0)
      for (let x = 0; x < width; x += 1) {
        const pixelOffset = y * stride + 1 + x * 4
        const isBackground = pixels[pixelOffset] === 20
          && pixels[pixelOffset + 1] === 108
          && pixels[pixelOffset + 2] === 104
        if (!isBackground) {
          maximumDistance = Math.max(maximumDistance, Math.hypot(x - center, y - center))
        }
      }
    }
    expect(maximumDistance).toBeLessThanOrEqual(safeRadius)
  })
})
