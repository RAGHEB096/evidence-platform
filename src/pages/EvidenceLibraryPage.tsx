import { ImageIcon, ImagesIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '@/auth/useAuth'
import { FilterSelect, ListToolbar } from '@/components/ListToolbar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  EMPTY_LIBRARY_FILTERS,
  LIBRARY_PAGE_SIZE,
  useEvidenceLibrary,
  useSignedUrls,
  type LibraryFilters,
  type LibraryRow,
} from '@/features/evidence/api'
import { EvidencePreviewDialog } from '@/features/evidence/EvidencePreviewDialog'
import { useProtocols } from '@/features/protocols/api'
import { useMyRoles } from '@/features/protocols/my-roles'
import { useProtocolRows } from '@/features/protocols/structure-api'
import { buildProtocolTree } from '@/features/protocols/tree'
import { useUserDirectory } from '@/features/users/api'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

const ALL = 'all'

function locationOf(row: LibraryRow): string {
  return [
    row.protocol?.reference,
    row.chapter?.title,
    row.function?.title,
    row.test_run ? `${row.test_run.reference ? `${row.test_run.reference} ` : ''}${row.test_run.title}` : null,
    row.test_step ? `Step ${row.test_step.reference || ''}`.trim() + (row.test_step.description ? `: ${row.test_step.description}` : '') : 'Whole test run',
  ]
    .filter(Boolean)
    .join(' › ')
}

export function EvidenceLibraryPage() {
  const { profile } = useAuth()
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS)
  const [page, setPage] = useState(0)
  const [preview, setPreview] = useState<number | null>(null)
  const search = useDebouncedValue(filters.search)
  const query = useMemo(() => ({ ...filters, search }), [filters, search])
  const library = useEvidenceLibrary(query, page)
  const protocols = useProtocols()
  const directory = useUserDirectory()
  const roles = useMyRoles()
  const structure = useProtocolRows(filters.protocolId)
  const rows = library.data?.rows ?? []
  const urls = useSignedUrls(rows.map((row) => row.storage_path))

  const update = (change: Partial<LibraryFilters>) => {
    setFilters((current) => ({ ...current, ...change }))
    setPage(0)
  }

  // Cascading location filters, from the chosen protocol's live structure.
  const options = useMemo(() => {
    if (!filters.protocolId || !structure.data) return { chapters: [], functions: [], runs: [] }
    const tree = buildProtocolTree(structure.data)
    const chapters = tree.map((c) => ({ value: c.row.id, label: `${c.number} ${c.row.title}` }))
    const fnNodes = tree.filter((c) => !filters.chapterId || c.row.id === filters.chapterId).flatMap((c) => c.functions)
    const functions = fnNodes.map((f) => ({ value: f.row.id, label: `${f.number} ${f.row.title}` }))
    const runs = fnNodes
      .filter((f) => !filters.functionId || f.row.id === filters.functionId)
      .flatMap((f) => f.testRuns)
      .map((r) => ({ value: r.row.id, label: `${r.number} ${r.row.title}` }))
    return { chapters, functions, runs }
  }, [filters.protocolId, filters.chapterId, filters.functionId, structure.data])

  const select = (value: string) => value || ALL
  const unselect = (value: string) => (value === ALL ? '' : value)
  const total = library.data?.total ?? 0
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_LIBRARY_FILTERS)

  return (
    <>
      <PageHeader title="Evidence Library" description="Screenshot evidence across every protocol you can access." />

      <ListToolbar search={filters.search} onSearch={(value) => update({ search: value })} placeholder="Search file names, captions and descriptions">
        <FilterSelect
          label="Protocol"
          value={select(filters.protocolId)}
          onChange={(value) => update({ protocolId: unselect(value), chapterId: '', functionId: '', testRunId: '' })}
          options={[{ value: ALL, label: 'All protocols' }, ...(protocols.data ?? []).filter((p) => !p.deleted_at).map((p) => ({ value: p.id, label: p.reference }))]}
        />
        {filters.protocolId ? (
          <>
            <FilterSelect
              label="Chapter"
              value={select(filters.chapterId)}
              onChange={(value) => update({ chapterId: unselect(value), functionId: '', testRunId: '' })}
              options={[{ value: ALL, label: 'All chapters' }, ...options.chapters]}
            />
            <FilterSelect
              label="Function"
              value={select(filters.functionId)}
              onChange={(value) => update({ functionId: unselect(value), testRunId: '' })}
              options={[{ value: ALL, label: 'All functions' }, ...options.functions]}
            />
            <FilterSelect
              label="Test run"
              value={select(filters.testRunId)}
              onChange={(value) => update({ testRunId: unselect(value) })}
              options={[{ value: ALL, label: 'All test runs' }, ...options.runs]}
            />
          </>
        ) : null}
        <FilterSelect
          label="Uploader"
          value={select(filters.uploadedBy)}
          onChange={(value) => update({ uploadedBy: unselect(value) })}
          options={[
            { value: ALL, label: 'All uploaders' },
            ...[...(directory.data?.values() ?? [])].map((user) => ({ value: user.id, label: user.display_name })),
          ]}
        />
      </ListToolbar>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="from-date">Uploaded from</Label>
          <Input id="from-date" type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => update({ from: event.target.value })} className="w-44" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to-date">Uploaded until</Label>
          <Input id="to-date" type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => update({ to: event.target.value })} className="w-44" />
        </div>
        {filtered ? (
          <Button variant="ghost" onClick={() => update(EMPTY_LIBRARY_FILTERS)}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {library.isPending ? (
        <LoadingState label="Loading evidence…" />
      ) : library.isError ? (
        <ErrorState message={toUserMessage(library.error)} onRetry={() => void library.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ImagesIcon}
          title={filtered ? 'No evidence matches' : 'No evidence yet'}
          description={filtered ? 'Change the search or filters to see more.' : 'Evidence appears here once testers upload screenshots in a test run’s execution view.'}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {page * LIBRARY_PAGE_SIZE + 1}–{page * LIBRARY_PAGE_SIZE + rows.length} of {total}
          </p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {rows.map((row, index) => {
              const url = urls.data?.get(row.storage_path)
              const uploader = directory.data?.get(row.uploaded_by)
              return (
                <li key={row.id} className="overflow-hidden rounded-lg border">
                  <button
                    type="button"
                    className="block w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => setPreview(index)}
                    aria-label={`Open ${row.original_filename}`}
                  >
                    <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                      {url ? <img src={url} alt="" loading="lazy" className="size-full object-contain" /> : <ImageIcon aria-hidden="true" className="size-6 text-muted-foreground" />}
                    </div>
                  </button>
                  <div className="space-y-1 p-3 text-sm">
                    <div className="truncate font-medium">{row.original_filename}</div>
                    <div className="truncate text-muted-foreground">{row.caption || 'No caption'}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{locationOf(row)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(row.uploaded_at)} · {uploader?.display_name ?? '—'}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-between">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
              Previous page
            </Button>
            <Button variant="outline" disabled={(page + 1) * LIBRARY_PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>
              Next page
            </Button>
          </div>
        </>
      )}

      <EvidencePreviewDialog
        items={rows}
        index={preview}
        onIndexChange={setPreview}
        onClose={() => setPreview(null)}
        location={(row) => locationOf(row as LibraryRow)}
        permissions={{ userId: profile?.id ?? '', isAdmin: !!profile?.is_admin, roleFor: (id) => roles.data?.get(id) ?? null }}
      />
    </>
  )
}
