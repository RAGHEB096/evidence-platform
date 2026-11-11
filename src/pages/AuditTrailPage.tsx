import { ChevronDownIcon, ChevronRightIcon, ScrollTextIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useAuth } from '@/auth/useAuth'
import { FilterSelect } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AUDIT_PAGE_SIZE,
  describeEvent,
  EMPTY_AUDIT_FILTERS,
  EVENT_LABELS,
  formatValue,
  useAuditEvents,
  type AuditEvent,
  type AuditFilters,
} from '@/features/audit/events'
import { useProtocols } from '@/features/protocols/api'
import { useUserDirectory } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

const ALL = 'all'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** "user anna.b", "setting upload_limit_bytes", "test_step 5dff4243". */
function itemLabel(event: AuditEvent, directory: Map<string, { username: string }> | undefined): string {
  const id = event.entity_id
  if (!id) return event.entity_type
  if (event.entity_type === 'user') return `user ${directory?.get(id)?.username ?? id.slice(0, 8)}`
  return `${event.entity_type} ${UUID.test(id) ? id.slice(0, 8) : id}`
}

function Changes({ event }: { event: AuditEvent }) {
  const changes = event.metadata.changes
  const row = event.metadata.row
  if (changes) {
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Before</th>
            <th className="py-1 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(changes).map(([field, change]) => (
            <tr key={field} className="align-top">
              <td className="py-1 pr-3 font-mono">{field}</td>
              <td className="py-1 pr-3 break-all">{formatValue(change.old)}</td>
              <td className="py-1 break-all">{formatValue(change.new)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (row) {
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
        {Object.entries(row).map(([field, value]) => (
          <Fragment key={field}>
            <dt className="font-mono text-muted-foreground">{field}</dt>
            <dd className="break-all">{formatValue(value)}</dd>
          </Fragment>
        ))}
      </dl>
    )
  }
  return <p className="text-xs text-muted-foreground">{event.metadata.source_id ? `Copied from ${event.metadata.source_id}` : 'No further details.'}</p>
}

/**
 * Read-only view of the append-only audit trail (SPEC 4.10). RLS decides what
 * comes back: administrators everything, managers their protocols, everyone
 * their own actions.
 */
export function AuditTrailPage() {
  const { profile } = useAuth()
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const events = useAuditEvents(filters, page)
  const protocols = useProtocols()
  const directory = useUserDirectory()
  const references = new Map((protocols.data ?? []).map((p) => [p.id, p.reference]))
  const update = (change: Partial<AuditFilters>) => {
    setFilters((current) => ({ ...current, ...change }))
    setPage(0)
  }
  const pick = (value: string) => (value === ALL ? '' : value)
  const total = events.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Audit Trail"
        description={
          profile?.is_admin
            ? 'Every recorded change, newest first. Times are stored by the server in UTC and shown in your time zone.'
            : 'Changes on the protocols you manage, and your own actions. Times are stored by the server in UTC and shown in your time zone.'
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <FilterSelect
          label="Protocol"
          value={filters.protocolId || ALL}
          onChange={(value) => update({ protocolId: pick(value) })}
          options={[{ value: ALL, label: 'All protocols' }, ...(protocols.data ?? []).map((p) => ({ value: p.id, label: p.reference }))]}
        />
        <FilterSelect
          label="User"
          value={filters.actorId || ALL}
          onChange={(value) => update({ actorId: pick(value) })}
          options={[{ value: ALL, label: 'All users' }, ...[...(directory.data?.values() ?? [])].map((u) => ({ value: u.id, label: u.display_name }))]}
        />
        <FilterSelect
          label="Event type"
          value={filters.eventType || ALL}
          onChange={(value) => update({ eventType: pick(value) })}
          options={[{ value: ALL, label: 'All events' }, ...Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label: label[0]!.toUpperCase() + label.slice(1) }))]}
        />
        <div className="space-y-1">
          <Label htmlFor="audit-from">From</Label>
          <Input id="audit-from" type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">Until</Label>
          <Input id="audit-to" type="date" value={filters.to} onChange={(event) => update({ to: event.target.value })} className="w-40" />
        </div>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY_AUDIT_FILTERS) ? (
          <Button variant="ghost" onClick={() => update(EMPTY_AUDIT_FILTERS)}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {events.isPending ? (
        <LoadingState label="Loading audit events…" />
      ) : events.isError ? (
        <ErrorState message={toUserMessage(events.error)} onRetry={() => void events.refetch()} />
      ) : events.data.events.length === 0 ? (
        <EmptyState icon={ScrollTextIcon} title="No events match" description="Change the filters, or come back once there is activity." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {page * AUDIT_PAGE_SIZE + 1}–{page * AUDIT_PAGE_SIZE + events.data.events.length} of {total}
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-0">
                    <span className="sr-only">Details</span>
                  </TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Item</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.events.map((event) => {
                  const expanded = open.has(event.id)
                  const actor = directory.data?.get(event.actor_id)
                  return (
                    <Fragment key={event.id}>
                      <TableRow>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} details of event ${event.id}`}
                            onClick={() =>
                              setOpen((current) => {
                                const next = new Set(current)
                                if (next.has(event.id)) next.delete(event.id)
                                else next.add(event.id)
                                return next
                              })
                            }
                          >
                            {expanded ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
                          </Button>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
                        </TableCell>
                        <TableCell className="text-sm">
                          {actor?.display_name ?? 'Unknown user'}
                          <div className="text-xs text-muted-foreground">{actor?.username}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {describeEvent(event.event_type)}
                          <div className="font-mono text-xs text-muted-foreground">{event.event_type}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{event.protocol_id ? (references.get(event.protocol_id) ?? '—') : '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{itemLabel(event, directory.data)}</TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={5} className="bg-muted/30">
                            <Changes event={event} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-between">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
              Newer
            </Button>
            <Button variant="outline" disabled={(page + 1) * AUDIT_PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>
              Older
            </Button>
          </div>
        </>
      )}
    </>
  )
}
