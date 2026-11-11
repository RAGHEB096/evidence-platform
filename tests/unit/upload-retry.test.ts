import { describe, expect, it, vi } from 'vitest'
import { finalizeWithRetry } from '@/features/evidence/upload'
import { ActionError } from '@/lib/functions'

const unavailable = () => new ActionError('The server could not complete the request.', undefined, 503)

describe('finalizeWithRetry', () => {
  it('retries transient failures and then succeeds', async () => {
    const call = vi.fn().mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(new ActionError('offline', undefined, 0)).mockResolvedValue({ id: 'x' })
    await finalizeWithRetry(call, 1)
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('treats "already registered" on a retry as success (the lost answer had succeeded)', async () => {
    const call = vi.fn().mockRejectedValueOnce(unavailable()).mockRejectedValue(new ActionError('x.png is already registered.', 'already_registered', 409))
    await expect(finalizeWithRetry(call, 1)).resolves.toBeUndefined()
  })

  it('does not retry a rejected image or a permission error', async () => {
    const invalid = vi.fn().mockRejectedValue(new ActionError('x.png is not a PNG, JPEG, WEBP, GIF or BMP image.', 'invalid_image', 422))
    await expect(finalizeWithRetry(invalid, 1)).rejects.toThrow('not a PNG')
    expect(invalid).toHaveBeenCalledTimes(1)
  })

  it('gives up after four attempts', async () => {
    const call = vi.fn().mockRejectedValue(unavailable())
    await expect(finalizeWithRetry(call, 1)).rejects.toBeInstanceOf(ActionError)
    expect(call).toHaveBeenCalledTimes(4)
  })
})
