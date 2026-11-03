import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = resolve(root, 'public/icons')

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

// ---- デザイン ------------------------------------------------------------
// 4列×3段のキー(Q W E R / A S D F / Z X C V)を、実物どおりの段ずれ(0 / 0.25 / 0.75)で並べる。
// 4列は4本の指(小指・薬指・中指・人差し指)で、色はアプリの色分けと同じ。
// ホームポジションのF(2段目・人差し指)だけ、白い縁と突起の線で強調する。
const BACKGROUND = [20, 108, 104]
const FINGER_COLORS = [
  [244, 185, 193], // 小指
  [244, 211, 145], // 薬指
  [169, 216, 182], // 中指
  [168, 205, 238], // 人差し指
]
const COLUMNS = 4
const ROW_OFFSETS = [0, 0.25, 0.75]
const PITCH = 0.18
const KEY_SIZE = PITCH * 0.88
const KEY_RADIUS = 0.032
const SHADOW_DEPTH = 0.014

function shade([red, green, blue], factor) {
  return [Math.round(red * factor), Math.round(green * factor), Math.round(blue * factor)]
}

// 描画順に並んだ角丸四角の一覧(座標は0〜1)。後ろにあるものほど手前に描く。
function buildShapes() {
  const width = (ROW_OFFSETS.at(-1) + COLUMNS - 1) * PITCH + KEY_SIZE
  const height = (ROW_OFFSETS.length - 1) * PITCH + KEY_SIZE
  const originX = (1 - width) / 2
  const originY = (1 - height) / 2 - SHADOW_DEPTH / 2
  const shapes = []

  ROW_OFFSETS.forEach((offset, row) => {
    for (let column = 0; column < COLUMNS; column += 1) {
      const left = originX + (offset + column) * PITCH
      const top = originY + row * PITCH
      const color = FINGER_COLORS[column]
      const isHome = row === 1 && column === COLUMNS - 1

      if (isHome) {
        const ring = 0.011
        shapes.push({
          left: left - ring, top: top - ring, right: left + KEY_SIZE + ring, bottom: top + KEY_SIZE + SHADOW_DEPTH + ring,
          radius: KEY_RADIUS + ring, color: [255, 253, 248],
        })
      }
      shapes.push({
        left, top: top + SHADOW_DEPTH, right: left + KEY_SIZE, bottom: top + KEY_SIZE + SHADOW_DEPTH,
        radius: KEY_RADIUS, color: shade(color, 0.7),
      })
      shapes.push({ left, top, right: left + KEY_SIZE, bottom: top + KEY_SIZE, radius: KEY_RADIUS, color })

      if (isHome) {
        const barWidth = KEY_SIZE * 0.4
        const barHeight = 0.012
        const barLeft = left + (KEY_SIZE - barWidth) / 2
        const barTop = top + KEY_SIZE * 0.72
        shapes.push({
          left: barLeft, top: barTop, right: barLeft + barWidth, bottom: barTop + barHeight,
          radius: barHeight / 2, color: [34, 39, 51],
        })
      }
    }
  })
  return shapes
}

function inRoundedRectangle(x, y, { left, top, right, bottom, radius }) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius))
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius))
  const dx = x - closestX
  const dy = y - closestY
  return dx * dx + dy * dy <= radius * radius
}

const SUBSAMPLES = 4

function createIcon(size, { maskable = false } = {}) {
  // maskable版は全体を80%に縮めて、中央80%の安全円(半径40%)内に収める。
  const scale = maskable ? 0.8 : 1
  const shapes = buildShapes().reverse()
  const pixels = Buffer.alloc(size * (size * 4 + 1))

  function colorAt(x, y) {
    // 縮小は中心(0.5, 0.5)を基準に、サンプル座標を拡大して戻す
    const px = 0.5 + (x - 0.5) / scale
    const py = 0.5 + (y - 0.5) / scale
    for (const shape of shapes) {
      if (inRoundedRectangle(px, py, shape)) return shape.color
    }
    return BACKGROUND
  }

  for (let y = 0; y < size; y += 1) {
    pixels[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const color = colorAt((x + (sx + 0.5) / SUBSAMPLES) / size, (y + (sy + 0.5) / SUBSAMPLES) / size)
          red += color[0]
          green += color[1]
          blue += color[2]
        }
      }
      const count = SUBSAMPLES * SUBSAMPLES
      const offset = y * (size * 4 + 1) + 1 + x * 4
      pixels[offset] = Math.round(red / count)
      pixels[offset + 1] = Math.round(green / count)
      pixels[offset + 2] = Math.round(blue / count)
      pixels[offset + 3] = 255
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND'),
  ])
}

mkdirSync(outputDirectory, { recursive: true })
for (const icon of [
  { filename: 'icon-180.png', size: 180 },
  { filename: 'icon-512.png', size: 512 },
  { filename: 'icon-maskable-512.png', size: 512, maskable: true },
]) {
  writeFileSync(
    resolve(outputDirectory, icon.filename),
    createIcon(icon.size, { maskable: icon.maskable }),
  )
}
