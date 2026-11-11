// Image format detection and validation, shared by the browser (before
// upload) and the finalize-evidence Edge Function (after upload). No imports,
// no platform APIs: it runs unchanged in Vite and in Deno.

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp'

export const FORMAT_MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

export const FORMAT_LABEL: Record<ImageFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WEBP',
  gif: 'GIF',
  bmp: 'BMP',
}

const EXTENSION_FORMAT: Record<string, ImageFormat> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  gif: 'gif',
  bmp: 'bmp',
}

/** MIME types browsers report for each format; an empty type is also accepted. */
const ACCEPTED_MIME: Record<ImageFormat, string[]> = {
  png: ['image/png'],
  jpeg: ['image/jpeg', 'image/pjpeg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  bmp: ['image/bmp', 'image/x-ms-bmp', 'image/x-bmp'],
}

export const ACCEPT_ATTRIBUTE = '.png,.jpg,.jpeg,.webp,.gif,.bmp,image/png,image/jpeg,image/webp,image/gif,image/bmp'

/** Largest width or height accepted, to refuse absurd or malicious headers. */
const MAX_DIMENSION = 50_000

export interface ImageInfo {
  format: ImageFormat
  mime: string
  width: number
  height: number
}

export type InspectResult = { ok: true; info: ImageInfo } | { ok: false; reason: string }

export function extensionOf(filename: string): string {
  const match = /\.([^./\\]+)$/.exec(filename)
  return match ? match[1]!.toLowerCase() : ''
}

export function formatForExtension(filename: string): ImageFormat | null {
  return EXTENSION_FORMAT[extensionOf(filename)] ?? null
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!
const u32le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + ((b[o + 3]! << 24) >>> 0)
const i32le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
const startsWith = (b: Uint8Array, bytes: number[]) => bytes.every((value, index) => b[index] === value)

const damaged = { ok: false, reason: 'appears to be incomplete or damaged' } as const

function sized(format: ImageFormat, width: number, height: number): InspectResult {
  if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) return damaged
  return { ok: true, info: { format, mime: FORMAT_MIME[format], width, height } }
}

function inspectPng(b: Uint8Array): InspectResult {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR') return damaged
  // The last chunk must be IEND (length 0, type, CRC).
  if (b.length < 45 || ascii(b, b.length - 8, 4) !== 'IEND') return damaged
  return sized('png', u32be(b, 16), u32be(b, 20))
}

function inspectJpeg(b: Uint8Array): InspectResult {
  // End-of-image marker, allowing a little trailing padding some encoders add.
  let hasEnd = false
  for (let index = b.length - 2; index >= Math.max(2, b.length - 1024); index--) {
    if (b[index] === 0xff && b[index + 1] === 0xd9) {
      hasEnd = true
      break
    }
  }
  if (!hasEnd) return damaged

  let offset = 2
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) return damaged
    const marker = b[offset + 1]!
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = u16be(b, offset + 2)
    if (length < 2) return damaged
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) return sized('jpeg', u16be(b, offset + 7), u16be(b, offset + 5))
    offset += 2 + length
  }
  return damaged
}

function inspectGif(b: Uint8Array): InspectResult {
  if (b.length < 14 || b[b.length - 1] !== 0x3b) return damaged
  return sized('gif', u16le(b, 6), u16le(b, 8))
}

function inspectWebp(b: Uint8Array): InspectResult {
  if (b.length < 30) return damaged
  if (u32le(b, 4) + 8 > b.length) return damaged
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8 ') return sized('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff)
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return damaged
    const bits = u32le(b, 21)
    return sized('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') return sized('webp', u24le(b, 24) + 1, u24le(b, 27) + 1)
  return damaged
}

function inspectBmp(b: Uint8Array): InspectResult {
  if (b.length < 26) return damaged
  if (u32le(b, 2) > b.length) return damaged
  const headerSize = u32le(b, 14)
  if (headerSize === 12) return sized('bmp', u16le(b, 18), u16le(b, 20))
  if (headerSize < 40 || b.length < 26) return damaged
  return sized('bmp', i32le(b, 18), Math.abs(i32le(b, 22)))
}

/** Detects the format from the bytes and checks that the file is complete. */
export function inspectImage(bytes: Uint8Array): InspectResult {
  if (bytes.length === 0) return { ok: false, reason: 'is empty' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return inspectPng(bytes)
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return inspectJpeg(bytes)
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return inspectGif(bytes)
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return inspectWebp(bytes)
  if (ascii(bytes, 0, 2) === 'BM') return inspectBmp(bytes)
  return { ok: false, reason: 'is not a PNG, JPEG, WEBP, GIF or BMP image' }
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/**
 * Full check of one file: extension, declared MIME type, size, content.
 * `reason` completes the sentence "<filename> …" so messages name the file.
 */
export function validateImageFile(file: { name: string; type: string; size: number; bytes: Uint8Array; maxBytes: number }): InspectResult {
  const extension = extensionOf(file.name)
  const expected = formatForExtension(file.name)
  if (!expected) {
    return { ok: false, reason: extension ? `has an unsupported extension (.${extension}). Use PNG, JPG, WEBP, GIF or BMP` : 'has no file extension' }
  }
  if (file.size > file.maxBytes) return { ok: false, reason: `is larger than the ${megabytes(file.maxBytes)} limit (${megabytes(file.size)})` }
  if (file.size === 0) return { ok: false, reason: 'is empty' }

  const inspected = inspectImage(file.bytes)
  if (!inspected.ok) return inspected
  if (inspected.info.format !== expected) {
    return { ok: false, reason: `is named .${extension} but its content is ${FORMAT_LABEL[inspected.info.format]}` }
  }
  const type = file.type.toLowerCase()
  if (type && !ACCEPTED_MIME[inspected.info.format].includes(type)) {
    return { ok: false, reason: `reports the type ${type}, which does not match its ${FORMAT_LABEL[inspected.info.format]} content` }
  }
  return inspected
}

/**
 * A storage-safe file name: keeps letters, digits, dot, underscore and
 * hyphen, at most 100 characters, and the extension in lower case.
 */
export function storageFileName(original: string): string {
  const extension = extensionOf(original)
  const stem = original.slice(0, original.length - (extension ? extension.length + 1 : 0))
  const cleanStem = stem
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 90)
  return `${cleanStem || 'image'}${extension ? `.${extension}` : ''}`
}
