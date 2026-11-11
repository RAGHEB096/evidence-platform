const dateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})

const dateOnly = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' })

/** Local date and time with the time-zone name, so timestamps are never ambiguous. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return dateTime.format(typeof value === 'string' ? new Date(value) : value)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return dateOnly.format(typeof value === 'string' ? new Date(value) : value)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** Case- and accent-insensitive "contains" for client-side search boxes. */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = normalise(query)
  if (!needle) return true
  return fields.some((field) => field && normalise(field).includes(needle))
}

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}
