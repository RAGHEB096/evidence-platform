const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'

/**
 * An initial password for an administrator to hand over. 14 characters,
 * always with letters and digits; ambiguous characters (0/O, 1/l/I) left out.
 */
export function generateInitialPassword(length = 14): string {
  const alphabet = LETTERS + DIGITS
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0]! % chars.length]!
  const chars = [pick(LETTERS), pick(DIGITS)]
  while (chars.length < length) chars.push(pick(alphabet))
  // Shuffle so the guaranteed letter and digit are not always first.
  for (let index = chars.length - 1; index > 0; index--) {
    const swap = crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1)
    ;[chars[index], chars[swap]] = [chars[swap]!, chars[index]!]
  }
  return chars.join('')
}
