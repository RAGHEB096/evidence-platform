import { ArrowLeftIcon, ArrowRightIcon, ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import type { EvidenceRow } from '@/features/evidence/api'
import { cn } from '@/lib/utils'

/**
 * One image in the report builder. Selecting it adds it to the draft; when
 * selected it shows its place in the step, a caption used in this report only
 * (the evidence record keeps its own), and buttons to change its order.
 */
export function SelectableEvidence({
  evidence,
  url,
  selected,
  order,
  count,
  captionOverride,
  disabled,
  onToggle,
  onPreview,
  onCaption,
  onMove,
}: {
  evidence: EvidenceRow
  url: string | undefined
  selected: boolean
  /** 1-based position among the selected images of this step, when selected. */
  order: number | null
  count: number
  captionOverride: string | null
  disabled: boolean
  onToggle: (selected: boolean) => void
  onPreview: () => void
  onCaption: (caption: string | null) => void
  onMove: (delta: number) => void
}) {
  const [caption, setCaption] = useState(captionOverride ?? '')
  const checkboxId = `select-${evidence.id}`

  function commitCaption() {
    const next = caption.trim() ? caption.trim() : null
    if (next !== (captionOverride ?? null)) onCaption(next)
  }

  return (
    <li className={cn('overflow-hidden rounded-md border', selected ? 'border-primary ring-1 ring-primary' : 'opacity-90')} data-selected={selected}>
      <div className="relative">
        <button type="button" onClick={onPreview} className="block w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`Preview ${evidence.original_filename}`}>
          <div className="flex aspect-[4/3] items-center justify-center bg-muted">
            {url ? <img src={url} alt="" loading="lazy" className="size-full object-contain" /> : <ImageIcon aria-hidden="true" className="size-6 text-muted-foreground" />}
          </div>
        </button>
        {selected && order ? (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">#{order}</span>
        ) : null}
      </div>
      <div className="space-y-2 p-2">
        <div className="flex items-start gap-2">
          <Checkbox id={checkboxId} checked={selected} disabled={disabled} onCheckedChange={(value) => onToggle(value === true)} className="mt-0.5" />
          <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer text-xs">
            <span className="block truncate font-medium">{evidence.original_filename}</span>
            <span className="block truncate text-muted-foreground">{evidence.caption || 'No caption'}</span>
          </label>
        </div>
        {selected ? (
          <>
            <Input
              aria-label={`Caption in this report for ${evidence.original_filename}`}
              placeholder={evidence.caption || 'Caption for this report'}
              value={caption}
              maxLength={500}
              disabled={disabled}
              onChange={(event) => setCaption(event.target.value)}
              onBlur={commitCaption}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              }}
              className="h-8 text-xs"
            />
            {count > 1 ? (
              <div className="flex justify-between">
                <Button variant="ghost" size="sm" className="h-7" disabled={disabled || order === 1} onClick={() => onMove(-1)} aria-label={`Move ${evidence.original_filename} earlier`}>
                  <ArrowLeftIcon aria-hidden="true" />
                  Earlier
                </Button>
                <Button variant="ghost" size="sm" className="h-7" disabled={disabled || order === count} onClick={() => onMove(1)} aria-label={`Move ${evidence.original_filename} later`}>
                  Later
                  <ArrowRightIcon aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  )
}
