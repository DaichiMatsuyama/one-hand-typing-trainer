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

function inRoundedRectangle(x, y, left, top, right, bottom, radius) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius))
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius))
  const dx = x - closestX
  const dy = y - closestY
  return dx * dx + dy * dy <= radius * radius
}

function createIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * (size * 4 + 1))
  // maskable版はキー外形全体を中央80%の安全円（半径40%）内に収める。
  const keyBounds = maskable
    ? { left: 0.24, top: 0.22, right: 0.76, bottom: 0.78, radius: 0.08 }
    : { left: 0.17, top: 0.15, right: 0.83, bottom: 0.85, radius: 0.1 }
  const keyLeft = Math.round(size * keyBounds.left)
  const keyTop = Math.round(size * keyBounds.top)
  const keyRight = Math.round(size * keyBounds.right)
  const keyBottom = Math.round(size * keyBounds.bottom)
  const radius = Math.round(size * keyBounds.radius)
  const border = Math.max(3, Math.round(size * 0.025))

  function paint(x, y, red, green, blue, alpha = 255) {
    const offset = y * (size * 4 + 1) + 1 + x * 4
    pixels[offset] = red
    pixels[offset + 1] = green
    pixels[offset + 2] = blue
    pixels[offset + 3] = alpha
  }

  for (let y = 0; y < size; y += 1) {
    pixels[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x += 1) {
      paint(x, y, 20, 108, 104)
      if (!inRoundedRectangle(x, y, keyLeft, keyTop, keyRight, keyBottom, radius)) continue

      const inside = inRoundedRectangle(
        x,
        y,
        keyLeft + border,
        keyTop + border,
        keyRight - border,
        keyBottom - border,
        Math.max(1, radius - border),
      )
      paint(x, y, ...(inside ? [255, 253, 248] : [34, 39, 51]))

      const fLeft = Math.round(size * 0.39)
      const fTop = Math.round(size * 0.33)
      const stemRight = Math.round(size * 0.46)
      const topRight = Math.round(size * 0.64)
      const middleRight = Math.round(size * 0.58)
      const fBottom = Math.round(size * 0.68)
      const bar = Math.round(size * 0.07)
      const isF = (x >= fLeft && x <= stemRight && y >= fTop && y <= fBottom)
        || (x >= fLeft && x <= topRight && y >= fTop && y <= fTop + bar)
        || (x >= fLeft && x <= middleRight && y >= Math.round(size * 0.48) && y <= Math.round(size * 0.48) + bar)
      if (inside && isF) paint(x, y, 20, 108, 104)

      const bumpY = Math.round(size * 0.73)
      if (inside && y >= bumpY && y <= bumpY + Math.max(2, Math.round(size * 0.015))
        && x >= Math.round(size * 0.42) && x <= Math.round(size * 0.58)) {
        paint(x, y, 34, 39, 51)
      }
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
