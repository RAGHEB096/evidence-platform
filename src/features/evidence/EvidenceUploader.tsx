import { useQueryClient } from '@tanstack/react-query'
import { ACCEPT_ATTRIBUTE } from '@shared/image-format.ts'
import { CheckCircle2Icon, CircleAlertIcon, LoaderIcon, UploadCloudIcon, XIcon } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/button'
import { evidenceKeys } from '@/features/evidence/api'
import { checkFile, uploadEvidence, type UploadPhase, type UploadTarget } from '@/features/evidence/upload'
import { formatBytes } from '@/lib/format'
import { ActionError } from '@/lib/functions'
import { cn } from '@/lib/utils'

interface Item {
  key: string
  file: File
  phase: UploadPhase
  progress: number
  message?: string
}

const CONCURRENCY = 3

const PHASE_TEXT: Record<UploadPhase, string> = {
  checking: 'Checking…',
  rejected: 'Rejected',
  queued: 'Waiting…',
  uploading: 'Uploading',
  verifying: 'Verifying and hashing…',
  done: 'Added',
  failed: 'Failed',
}

/**
 * Several files at once by drag and drop or picker. Each file is checked and
 * uploaded on its own: one bad file never cancels the rest, and every
 * rejection names the file and the reason (SPEC 4.4).
 */
export function EvidenceUploader({ target, maxBytes, label }: { target: UploadTarget; maxBytes: number; label: string }) {
  const queryClient = useQueryClient()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const active = useRef(0)
  const waiting = useRef<Item[]>([])

  const patch = (key: string, change: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)))

  function pump() {
    while (active.current < CONCURRENCY && waiting.current.length) {
      const item = waiting.current.shift()!
      active.current += 1
      patch(item.key, { phase: 'uploading', progress: 0 })
      uploadEvidence(
        item.file,
        target,
        (fraction) => patch(item.key, { progress: fraction }),
        () => patch(item.key, { phase: 'verifying' }),
      )
        .then(() => {
          patch(item.key, { phase: 'done', progress: 1 })
          void queryClient.invalidateQueries({ queryKey: evidenceKeys.all })
        })
        .catch((error: unknown) =>
          patch(item.key, {
            phase: 'failed',
            message: error instanceof ActionError ? error.message : `${item.file.name} could not be added. Try again.`,
          }),
        )
        .finally(() => {
          active.current -= 1
          pump()
        })
    }
  }

  async function addFiles(files: FileList | File[]) {
    const added: Item[] = Array.from(files).map((file) => ({ key: crypto.randomUUID(), file, phase: 'checking', progress: 0 }))
    if (!added.length) return
    setItems((current) => [...added, ...current])
    await Promise.all(
      added.map(async (item) => {
        const problem = await checkFile(item.file, maxBytes)
        if (problem) {
          patch(item.key, { phase: 'rejected', message: problem })
        } else {
          patch(item.key, { phase: 'queued' })
          waiting.current.push(item)
        }
      }),
    )
    pump()
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void addFiles(event.dataTransfer.files)
  }

  const finished = items.filter((item) => item.phase === 'done' || item.phase === 'rejected' || item.phase === 'failed')

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
        )}
      >
        <UploadCloudIcon aria-hidden="true" className="size-6 text-muted-foreground" />
        <p>
          Drop screenshots here, or{' '}
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => inputRef.current?.click()}>
            choose files
          </Button>
        </p>
        <p className="text-xs text-muted-foreground">PNG, JPG, WEBP, GIF or BMP, up to {formatBytes(maxBytes)} each.</p>
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {items.length ? (
        <ul aria-label="Uploads" className="space-y-1">
          {items.map((item) => (
            <li key={item.key} className="rounded-md border px-3 py-2 text-sm" data-upload-phase={item.phase}>
              <div className="flex items-center gap-2">
                {item.phase === 'done' ? (
                  <CheckCircle2Icon aria-hidden="true" className="size-4 shrink-0 text-emerald-600" />
                ) : item.phase === 'rejected' || item.phase === 'failed' ? (
                  <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-red-600" />
                ) : (
                  <LoaderIcon aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{item.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {PHASE_TEXT[item.phase]}
                  {item.phase === 'uploading' ? ` ${Math.round(item.progress * 100)}%` : ''}
                </span>
              </div>
              {item.phase === 'uploading' || item.phase === 'verifying' ? (
                <div
                  role="progressbar"
                  aria-label={`Upload of ${item.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(item.progress * 100)}
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${item.progress * 100}%` }} />
                </div>
              ) : null}
              {item.message ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {item.message}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {finished.length ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setItems((current) => current.filter((item) => !finished.includes(item)))}
        >
          <XIcon aria-hidden="true" />
          Clear finished
        </Button>
      ) : null}
    </div>
  )
}
