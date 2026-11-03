import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LANDSCAPE_LAYOUT,
  calculateLandscapeLayout,
  estimatePromptWidth,
} from './layoutMetrics.js'

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8'),
)

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
  it('キーのピッチを高さ・幅の小さい方から求め、115pxを上限にする', () => {
    expect(styles).toContain('--key-pitch-height:')
    expect(styles).toContain('--key-pitch-width:')
    expect(styles).toMatch(
      /--key-pitch:\s*clamp\(49px,\s*min\(var\(--key-pitch-height\),\s*var\(--key-pitch-width\)\),\s*115px\)/,
    )
    expect(styles).toContain('--key-size: calc(var(--key-pitch) - var(--key-gap))')
    expect(styles).toContain('margin-left: calc(var(--row-offset) * var(--key-pitch))')
    expect(styles).toContain(`--info-strip-height: ${LANDSCAPE_LAYOUT.infoStripHeight}px`)
    expect(styles).toContain(`--layout-gap: ${LANDSCAPE_LAYOUT.layoutGap}px`)
    expect(styles).toContain('- var(--info-strip-height) - var(--layout-gap)) / 3')
    expect(styles).not.toContain('grid-template-areas: "keyboard info"')
  })

  it('情報ストリップを常に上部、キーボードを残りの領域に配置する', () => {
    expect(styles).toMatch(/grid-template-areas:\s*"strip"\s*"keyboard"/)
    expect(styles).toContain('grid-template-columns: max-content minmax(186px, 1fr) max-content')
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
      expect(metrics.keyPitch).toBeLessThanOrEqual(115)
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

  it('852x393とsafe-area左右59・下21の算出値を固定する', () => {
    const metrics = calculateLandscapeLayout({
      width: 852,
      height: 393,
      safeArea: { left: 59, right: 59, bottom: 21 },
    })

    expect(metrics.availableWidth).toBe(734)
    expect(metrics.availableHeight).toBe(367)
    expect(metrics.keyboardAreaHeight).toBe(317)
    expect(metrics.heightPitch).toBeCloseTo(105.67, 2)
    expect(metrics.widthPitch).toBeCloseTo(127.65, 2)
    expect(metrics.keyPitch).toBeCloseTo(105.67, 2)
    expect(metrics.keySize).toBeCloseTo(98.8, 2)
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
    expect(styles).toContain('grid-template-columns: max-content minmax(186px, 1fr) max-content')
    expect(styles).toMatch(/\.prompt-text \{[\s\S]*font-size:\s*20px/)
    expect(styles).toMatch(/\.prompt-text \{[\s\S]*white-space:\s*nowrap/)
    expect(styles).toMatch(/\.prompt-text \.current \{[\s\S]*font-size:\s*clamp\(1\.7rem/)
    expect(contrastRatio('303946', 'fffdf8')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('657080', 'fffdf8')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('ホーム画面用アセット', () => {
  it('GitHub Pagesのbaseから解決できる相対manifestを持つ', () => {
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.display).toBe('standalone')
    expect(manifest.orientation).toBe('landscape')
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      'icons/icon-180.png',
      'icons/icon-512.png',
    ])
  })

  it.each([180, 512])('%dpxのPNGアイコンが正しい寸法で存在する', (size) => {
    const icon = readFileSync(resolve(process.cwd(), `public/icons/icon-${size}.png`))
    expect([...icon.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(icon.readUInt32BE(16)).toBe(size)
    expect(icon.readUInt32BE(20)).toBe(size)
  })
})
