import { ActivityIcon, FolderKanbanIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { FilterSelect, ListToolbar } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { StatusBadge } from '@/components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { STORAGE_PLAN_LIMIT_BYTES } from '@/config'
import { PROTOCOL_STATUSES, type ProtocolStatus } from '@/domain/status'
import { describeEvent, EMPTY_AUDIT_FILTERS, useAuditEvents } from '@/features/audit/events'
import { useDashboardTotals, useProtocolOverview, useStorageUsage, type ProtocolOverviewRow } from '@/features/dashboard/api'
import { useUserDirectory } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'
import { formatBytes, formatDateTime, matchesSearch } from '@/lib/format'
import { cn } from '@/lib/utils'

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value ?? '—'}</dd>
    </div>
  )
}

function Meter({ value, max, label, tone = 'bg-primary' }: { value: number; max: number; label: string; tone?: string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full', tone)} style={{ width: `${percent}%` }} />
    </div>
  )
}

function Progress({ row }: { row: ProtocolOverviewRow }) {
  if (row.steps === 0) return <span className="text-sm text-muted-foreground">No steps</span>
  return (
    <div className="min-w-40 space-y-1">
      <Meter value={row.steps_executed} max={row.steps} label={`${row.reference} execution progress`} />
      <div className="text-xs text-muted-foreground tabular-nums">
        {row.steps_executed} of {row.steps} executed · {row.steps_passed} passed
      </div>
    </div>
  )
}

function StorageCard() {
  const usage = useStorageUsage(true)
  if (usage.isPending) return <LoadingState rows={1} label="Loading storage usage…" />
  if (usage.isError) return <ErrorState message={toUserMessage(usage.error)} onRetry={() => void usage.refetch()} />
  const used = usage.data.evidence_bytes + usage.data.exports_bytes
  const share = used / STORAGE_PLAN_LIMIT_BYTES
  return (
    <section aria-labelledby="storage-heading" className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="storage-heading" className="font-semibold">
          File storage
        </h2>
        <span className="text-sm tabular-nums">
          {formatBytes(used)} of {formatBytes(STORAGE_PLAN_LIMIT_BYTES)} ({Math.round(share * 100)}%)
        </span>
      </div>
      <Meter value={used} max={STORAGE_PLAN_LIMIT_BYTES} label="File storage used" tone={share > 0.8 ? 'bg-amber-500' : 'bg-primary'} />
      <p className="text-xs text-muted-foreground">
        Evidence {formatBytes(usage.data.evidence_bytes)} · saved reports {formatBytes(usage.data.exports_bytes)}
        {usage.data.orphan_bytes ? ` · unfinished uploads ${formatBytes(usage.data.orphan_bytes)}` : ''}. Storage is the first limit of the
        free plan; plan an upgrade before it is reached.
      </p>
    </section>
  )
}

function RecentActivity({ references }: { references: Map<string, string> }) {
  const events = useAuditEvents(EMPTY_AUDIT_FILTERS, 0, 12)
  const directory = useUserDirectory()
  return (
    <section aria-labelledby="activity-heading" className="space-y-2 rounded-lg border p-4">
      <h2 id="activity-heading" className="font-semibold">
        Recent activity
      </h2>
      {events.isPending ? (
        <LoadingState rows={3} label="Loading activity…" />
      ) : events.isError ? (
        <ErrorState message={toUserMessage(events.error)} onRetry={() => void events.refetch()} />
      ) : events.data.events.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No activity yet" description="Changes you can see in the audit trail will appear here." />
      ) : (
        <ol className="divide-y">
          {events.data.events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
              <span>
                <span className="font-medium">{directory.data?.get(event.actor_id)?.display_name ?? 'Someone'}</span> {describeEvent(event.event_type)}
                {event.protocol_id && references.get(event.protocol_id) ? (
                  <span className="text-muted-foreground"> · {references.get(event.protocol_id)}</span>
                ) : null}
              </span>
              <time dateTime={event.occurred_at} className="text-xs text-muted-foreground">
                {formatDateTime(event.occurred_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function DashboardPage() {
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const totals = useDashboardTotals()
  const overview = useProtocolOverview()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ProtocolStatus>('all')
  const references = useMemo(() => new Map((overview.data ?? []).map((row) => [row.id, row.reference])), [overview.data])
  const rows = useMemo(
    () => (overview.data ?? []).filter((row) => matchesSearch(search, row.name, row.reference) && (status === 'all' || row.status === status)),
    [overview.data, search, status],
  )

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={isAdmin ? 'Figures across every protocol.' : 'Figures for the protocols you are assigned to.'}
      />

      {totals.isError ? (
        <ErrorState message={toUserMessage(totals.error)} onRetry={() => void totals.refetch()} />
      ) : (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Protocols" value={totals.data?.protocols} />
          <Stat label="Assigned to me" value={totals.data?.assigned_protocols} />
          <Stat label="Chapters" value={totals.data?.chapters} />
          <Stat label="Test runs" value={totals.data?.test_runs} />
          <Stat label="Evidence files" value={totals.data?.evidence_files} />
          <Stat label="Generated documents" value={totals.data?.generated_documents} />
        </dl>
      )}

      {isAdmin ? <StorageCard /> : null}

      <section aria-labelledby="protocols-heading" className="space-y-3">
        <h2 id="protocols-heading" className="font-semibold">
          Protocols
        </h2>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search protocols by name or reference">
          <FilterSelect
            label="Protocol status"
            value={status}
            onChange={setStatus}
            options={[{ value: 'all', label: 'All statuses' }, ...(Object.keys(PROTOCOL_STATUSES) as ProtocolStatus[]).map((s) => ({ value: s, label: PROTOCOL_STATUSES[s].label }))]}
          />
        </ListToolbar>
        {overview.isPending ? (
          <LoadingState label="Loading protocols…" />
        ) : overview.isError ? (
          <ErrorState message={toUserMessage(overview.error)} onRetry={() => void overview.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FolderKanbanIcon}
            title={overview.data.length ? 'No protocols match' : 'No protocols yet'}
            description={overview.data.length ? 'Change the search or filter.' : 'Protocols you can access will appear here with their progress.'}
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chapters</TableHead>
                  <TableHead className="text-right">Test runs</TableHead>
                  <TableHead>Execution</TableHead>
                  <TableHead>Last modified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link to={`/protocols/${row.id}`} className="font-medium underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{row.reference}</div>
                    </TableCell>
                    <TableCell>{row.version}</TableCell>
                    <TableCell>
                      <StatusBadge status={PROTOCOL_STATUSES[row.status]} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.chapters}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.test_runs}</TableCell>
                    <TableCell>
                      <Progress row={row} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(row.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <RecentActivity references={references} />
    </>
  )
}
