// Regenerates tests/fixtures/images: real PNG/JPEG/WEBP rendered by Chromium,
// plus a minimal GIF and BMP built byte by byte. Run: node scripts/make-image-fixtures.mjs tests/fixtures/images
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const out = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage()
const shots = await page.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 48
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1d4ed8'; ctx.fillRect(0, 0, 64, 48)
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(8, 8, 30, 20)
  ctx.fillStyle = '#ffffff'; ctx.font = '12px sans-serif'; ctx.fillText('OK', 40, 40)
  const toB64 = (type, q) => new Promise((resolve) => canvas.toBlob(async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const b of buf) s += String.fromCharCode(b); resolve(btoa(s))
  }, type, q))
  return { png: await toB64('image/png'), jpg: await toB64('image/jpeg', 0.9), webp: await toB64('image/webp', 0.9) }
})
for (const [ext, b64] of Object.entries(shots)) writeFileSync(`${out}/screenshot.${ext}`, Buffer.from(b64, 'base64'))
// GIF: the well-known 1x1 transparent GIF89a.
writeFileSync(`${out}/pixel.gif`, Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
// BMP: 4x3, 24-bit, rows padded to 4 bytes.
const w = 4, h = 3, row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * h
const bmp = Buffer.alloc(size)
bmp.write('BM', 0); bmp.writeUInt32LE(size, 2); bmp.writeUInt32LE(54, 10)
bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(w, 18); bmp.writeInt32LE(h, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28)
bmp.writeUInt32LE(row * h, 34)
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * row + x * 3; bmp[o] = 200; bmp[o + 1] = 80; bmp[o + 2] = 20 }
writeFileSync(`${out}/pixels.bmp`, bmp)
await browser.close()
console.log('fixtures written')
