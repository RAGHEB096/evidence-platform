import { cn } from '@/lib/utils'
import type { StatusDefinition, StatusTone } from '@/domain/status'

const toneClasses: Record<StatusTone, { badge: string; dot: string }> = {
  neutral: { badge: 'border-slate-300 bg-slate-50 text-slate-700', dot: 'bg-slate-400' },
  info: { badge: 'border-blue-300 bg-blue-50 text-blue-800', dot: 'bg-blue-500' },
  success: { badge: 'border-emerald-300 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  danger: { badge: 'border-red-300 bg-red-50 text-red-800', dot: 'bg-red-500' },
  warning: { badge: 'border-amber-300 bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  muted: { badge: 'border-zinc-200 bg-zinc-100 text-zinc-600', dot: 'bg-zinc-400' },
}

/** Status shown as label plus colour, never colour alone. */
export function StatusBadge({ status, className, size = 'md' }: { status: StatusDefinition; className?: string; size?: 'sm' | 'md' }) {
  const tone = toneClasses[status.tone]
  return (
    <span
      data-tone={status.tone}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-xs',
        tone.badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone.dot)} />
      {status.label}
    </span>
  )
}
