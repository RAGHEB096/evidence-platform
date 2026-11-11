import { ImageIcon } from 'lucide-react'
import { useSignedUrls, type EvidenceRow } from '@/features/evidence/api'

/**
 * Thumbnails (originals scaled by CSS, lazy-loaded; ARCHITECTURE section 8)
 * that open the large preview.
 */
export function EvidenceGallery({ items, onOpen, emptyText }: { items: EvidenceRow[]; onOpen: (index: number) => void; emptyText?: string }) {
  const urls = useSignedUrls(items.map((item) => item.storage_path))

  if (!items.length) return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2" aria-label="Evidence">
      {items.map((item, index) => {
        const url = urls.data?.get(item.storage_path)
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(index)}
              className="group w-full overflow-hidden rounded-md border text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Open ${item.original_filename}${item.caption ? ` — ${item.caption}` : ''}`}
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                {url ? (
                  <img src={url} alt="" loading="lazy" className="size-full object-contain transition-transform group-hover:scale-[1.02]" />
                ) : (
                  <ImageIcon aria-hidden="true" className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-0.5 px-2 py-1.5">
                <div className="truncate text-xs font-medium">{item.original_filename}</div>
                <div className="truncate text-xs text-muted-foreground">{item.caption || 'No caption'}</div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
