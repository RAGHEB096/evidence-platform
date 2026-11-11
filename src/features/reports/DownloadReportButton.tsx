import { DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { reportDownloadUrl, type HistoryRow } from '@/features/reports/api'
import { reportFileName } from '@/features/reports/generate'
import { toUserMessage } from '@/lib/errors'

/** Downloads a saved report through a one-minute signed URL. */
export function DownloadReportButton({ row, size = 'sm' }: { row: HistoryRow; size?: 'sm' | 'default' }) {
  const [pending, setPending] = useState(false)
  if (!row.storage_path) return <span className="text-sm text-muted-foreground">Not saved</span>

  async function download() {
    setPending(true)
    try {
      const fileName = reportFileName(row.protocol?.reference ?? 'Report', new Date(row.generated_at ?? row.created_at))
      window.location.assign(await reportDownloadUrl(row.storage_path!, fileName))
    } catch (error) {
      toast.error(toUserMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="outline" size={size} onClick={() => void download()} disabled={pending} aria-label={`Download ${row.name}`}>
      <DownloadIcon aria-hidden="true" />
      Download
    </Button>
  )
}
