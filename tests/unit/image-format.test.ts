import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspectImage, storageFileName, validateImageFile } from '@shared/image-format.ts'

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/images/${name}`))
const MB = 1024 * 1024

function validate(name: string, bytes: Uint8Array, type = '', maxBytes = 20 * MB) {
  return validateImageFile({ name, type, size: bytes.length, bytes, maxBytes })
}

describe('inspectImage', () => {
  it.each([
    ['screenshot.png', 'png', 64, 48],
    ['screenshot.jpg', 'jpeg', 64, 48],
    ['screenshot.webp', 'webp', 64, 48],
    ['pixel.gif', 'gif', 1, 1],
    ['pixels.bmp', 'bmp', 4, 3],
  ] as const)('reads %s as %s %dx%d', (name, format, width, height) => {
    const result = inspectImage(fixture(name))
    expect(result).toEqual({ ok: true, info: expect.objectContaining({ format, width, height }) })
  })

  it('rejects a text file renamed to .png', () => {
    const bytes = new TextEncoder().encode('This is not an image, just text pretending to be one.')
    expect(validate('notes.png', bytes)).toEqual({ ok: false, reason: 'is not a PNG, JPEG, WEBP, GIF or BMP image' })
  })

  it.each(['screenshot.png', 'screenshot.jpg', 'screenshot.webp', 'pixel.gif', 'pixels.bmp'])('rejects a truncated %s', (name) => {
    const whole = fixture(name)
    const truncated = whole.subarray(0, Math.floor(whole.length * 0.6))
    const result = inspectImage(truncated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('appears to be incomplete or damaged')
  })

  it('rejects an empty file', () => {
    expect(inspectImage(new Uint8Array())).toEqual({ ok: false, reason: 'is empty' })
  })
})

describe('validateImageFile', () => {
  it('accepts each allowed format with a matching extension and type', () => {
    expect(validate('a.png', fixture('screenshot.png'), 'image/png').ok).toBe(true)
    expect(validate('a.JPG', fixture('screenshot.jpg'), 'image/jpeg').ok).toBe(true)
    expect(validate('a.jpeg', fixture('screenshot.jpg')).ok).toBe(true)
    expect(validate('a.webp', fixture('screenshot.webp'), 'image/webp').ok).toBe(true)
    expect(validate('a.gif', fixture('pixel.gif'), 'image/gif').ok).toBe(true)
    expect(validate('a.bmp', fixture('pixels.bmp'), 'image/x-ms-bmp').ok).toBe(true)
  })

  it('rejects an unsupported extension, naming it', () => {
    expect(validate('report.pdf', fixture('screenshot.png'))).toEqual({
      ok: false,
      reason: 'has an unsupported extension (.pdf). Use PNG, JPG, WEBP, GIF or BMP',
    })
    expect(validate('README', fixture('screenshot.png'))).toEqual({ ok: false, reason: 'has no file extension' })
  })

  it('rejects content that does not match the extension', () => {
    expect(validate('photo.jpg', fixture('screenshot.png'))).toEqual({ ok: false, reason: 'is named .jpg but its content is PNG' })
  })

  it('rejects a declared MIME type that does not match the content', () => {
    const result = validate('photo.png', fixture('screenshot.png'), 'image/gif')
    expect(result).toEqual({ ok: false, reason: 'reports the type image/gif, which does not match its PNG content' })
  })

  it('rejects files over the configured limit, saying what the limit is', () => {
    const result = validateImageFile({ name: 'big.png', type: 'image/png', size: 21 * MB, bytes: fixture('screenshot.png'), maxBytes: 20 * MB })
    expect(result).toEqual({ ok: false, reason: 'is larger than the 20 MB limit (21 MB)' })
  })
})

describe('storageFileName', () => {
  it('keeps safe characters and the extension', () => {
    expect(storageFileName('Login screen (v2).PNG')).toBe('Login_screen_v2.png')
    expect(storageFileName('écran été.jpg')).toBe('ecran_ete.jpg')
    expect(storageFileName('../../etc/passwd.png')).toBe('etc_passwd.png')
    expect(storageFileName('.png')).toBe('image.png')
  })
})
