import { ArchiveIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useEvidenceMutations, useSignedUrls, type EvidenceRow } from '@/features/evidence/api'
import { canArchiveEvidence, canEditEvidence, type EvidencePermissions } from '@/features/evidence/permissions'
import { useUserDirectory } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'
import { formatBytes, formatDateTime } from '@/lib/format'

/** Large preview with next/previous (buttons and arrow keys) and the item's record. */
export function EvidencePreviewDialog({
  items,
  index,
  onIndexChange,
  onClose,
  location,
  permissions,
}: {
  items: EvidenceRow[]
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  location: (item: EvidenceRow) => string
  permissions: EvidencePermissions
}) {
  const item = index === null ? undefined : items[index]

  useEffect(() => {
    if (index === null) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (event.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onIndexChange])

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-6xl">
        {item ? (
          <PreviewBody
            key={item.id}
            item={item}
            position={`${index! + 1} of ${items.length}`}
            hasPrevious={index! > 0}
            hasNext={index! < items.length - 1}
            onPrevious={() => onIndexChange(index! - 1)}
            onNext={() => onIndexChange(index! + 1)}
            onArchived={onClose}
            location={location(item)}
            permissions={permissions}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({
  item,
  position,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onArchived,
  location,
  permissions,
}: {
  item: EvidenceRow
  position: string
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  onArchived: () => void
  location: string
  permissions: EvidencePermissions
}) {
  const urls = useSignedUrls([item.storage_path])
  const url = urls.data?.get(item.storage_path)
  const directory = useUserDirectory()
  const { updateMetadata, archive } = useEvidenceMutations()
  const [caption, setCaption] = useState(item.caption)
  const [description, setDescription] = useState(item.description)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const editable = canEditEvidence(item, permissions)
  const dirty = caption !== item.caption || description !== item.description
  const uploader = directory.data?.get(item.uploaded_by)

  async function save() {
    try {
      await updateMetadata.mutateAsync({ id: item.id, caption: caption.trim(), description })
      toast.success('Evidence details saved')
    } catch (error) {
      toast.error(toUserMessage(error))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={onPrevious} disabled={!hasPrevious} aria-label="Previous evidence">
            <ChevronLeftIcon aria-hidden="true" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {position}
          </span>
          <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext} aria-label="Next evidence">
            Next
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="flex min-h-64 items-center justify-center rounded-md border bg-muted/40">
          {url ? (
            <img src={url} alt={item.caption || item.original_filename} className="max-h-[70vh] w-auto max-w-full object-contain" />
          ) : (
            <span className="text-sm text-muted-foreground">{urls.isError ? 'The image could not be loaded.' : 'Loading image…'}</span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <DialogTitle className="break-all">{item.original_filename}</DialogTitle>
          <DialogDescription>{location}</DialogDescription>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="evidence-caption">Caption</Label>
            <Input id="evidence-caption" value={caption} maxLength={500} readOnly={!editable} onChange={(event) => setCaption(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="evidence-description">Description</Label>
            <Textarea id="evidence-description" rows={3} value={description} maxLength={5000} readOnly={!editable} onChange={(event) => setDescription(event.target.value)} />
          </div>
          {editable ? (
            <Button size="sm" onClick={() => void save()} disabled={!dirty || updateMetadata.isPending}>
              {updateMetadata.isPending ? 'Saving…' : 'Save details'}
            </Button>
          ) : null}
        </div>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Uploaded</dt>
          <dd>{formatDateTime(item.uploaded_at)}</dd>
          <dt className="text-muted-foreground">By</dt>
          <dd>{uploader ? `${uploader.display_name} (${uploader.username})` : '—'}</dd>
          <dt className="text-muted-foreground">Size</dt>
          <dd>
            {formatBytes(item.size_bytes)} · {item.width}×{item.height} px
          </dd>
          <dt className="text-muted-foreground">SHA-256</dt>
          <dd className="font-mono text-xs break-all">{item.sha256}</dd>
        </dl>

        <div className="flex flex-wrap gap-2">
          {url ? (
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden="true" />
                Open original
              </a>
            </Button>
          ) : null}
          {canArchiveEvidence(item, permissions) ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmArchive(true)}>
              <ArchiveIcon aria-hidden="true" />
              Archive…
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${item.original_filename}?`}
        description={
          <>
            <p>It disappears from the execution view, the Evidence Library and draft reports.</p>
            <p>The original file stays in storage unchanged, and an administrator can restore it.</p>
          </>
        }
        confirmLabel="Archive"
        destructive
        pending={archive.isPending}
        onConfirm={() =>
          archive.mutate(item.id, {
            onSuccess: () => {
              setConfirmArchive(false)
              toast.success('Evidence archived')
              onArchived()
            },
            onError: (error) => toast.error(toUserMessage(error)),
          })
        }
      />
    </div>
  )
}
