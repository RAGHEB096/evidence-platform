import { ArrowLeftIcon, FileTextIcon, ImagesIcon, LockIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { roleAtLeast } from '@/domain/roles'
import { PROTOCOL_STATUSES } from '@/domain/status'
import { useSignedUrls, type EvidenceRow } from '@/features/evidence/api'
import { EvidencePreviewDialog } from '@/features/evidence/EvidencePreviewDialog'
import { useMyProtocolRole, useProtocol, useProtocolRows } from '@/features/protocols/structure-api'
import { buildProtocolTree, flattenSteps, type ChapterNode, type TestRunNode } from '@/features/protocols/tree'
import { useDraftExport, useExportItems, useProtocolEvidence, useReportSettings, useSelectionMutations, type ExportItemRow } from '@/features/reports/api'
import { downloadBlob, generateReport, type GenerationProgress } from '@/features/reports/generate'
import { buildReportModel } from '@/features/reports/model'
import { SelectableEvidence } from '@/features/reports/SelectableEvidence'
import { useUserDirectory } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

const PHASE_TEXT: Record<GenerationProgress['phase'], string> = {
  images: 'Preparing images',
  packing: 'Assembling the Word document',
  saving: 'Saving a copy to Generated Documents',
  recording: 'Recording the export',
}

type Group = { key: string; label: string; evidence: EvidenceRow[] }

/** Evidence groups of a test run: the run as a whole, then each step in order. */
function runGroups(run: TestRunNode, byGroup: Map<string, EvidenceRow[]>): Group[] {
  const groups: Group[] = [{ key: run.row.id, label: 'Whole test run', evidence: byGroup.get(run.row.id) ?? [] }]
  for (const step of flattenSteps(run.steps)) {
    groups.push({ key: step.row.id, label: `Step ${step.number}: ${step.row.description}`, evidence: byGroup.get(step.row.id) ?? [] })
  }
  return groups.filter((group) => group.evidence.length > 0)
}

function chapterEvidence(chapter: ChapterNode, byGroup: Map<string, EvidenceRow[]>): EvidenceRow[] {
  return chapter.functions.flatMap((fn) => fn.testRuns.flatMap((run) => runGroups(run, byGroup).flatMap((group) => group.evidence)))
}

function TriStateCheckbox({ id, label, ids, selected, disabled, onChange }: { id: string; label: string; ids: string[]; selected: Map<string, ExportItemRow>; disabled: boolean; onChange: (select: boolean) => void }) {
  const count = ids.filter((evidenceId) => selected.has(evidenceId)).length
  const state = count === 0 ? false : count === ids.length ? true : 'indeterminate'
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={state} disabled={disabled || ids.length === 0} onCheckedChange={() => onChange(state !== true)} />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label} ({count}/{ids.length})
      </Label>
    </div>
  )
}

export function ReportBuilderPage() {
  const { protocolId = '' } = useParams()
  const { profile } = useAuth()
  const protocol = useProtocol(protocolId)
  const rows = useProtocolRows(protocolId)
  const role = useMyProtocolRole(protocolId)
  const evidence = useProtocolEvidence(protocolId)
  const draft = useDraftExport(protocolId)
  const items = useExportItems(draft.data?.id)
  const settings = useReportSettings()
  const directory = useUserDirectory()
  const mutations = useSelectionMutations(protocolId, protocol.data?.reference ?? 'Protocol')
  const urls = useSignedUrls((evidence.data ?? []).map((row) => row.storage_path))
  const [saveCopy, setSaveCopy] = useState(true)
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [preview, setPreview] = useState<number | null>(null)

  const tree = useMemo(() => (rows.data ? buildProtocolTree(rows.data) : []), [rows.data])
  const selected = useMemo(() => new Map((items.data ?? []).map((item) => [item.evidence_id, item])), [items.data])
  const byGroup = useMemo(() => {
    const map = new Map<string, EvidenceRow[]>()
    for (const row of evidence.data ?? []) {
      const key = row.test_step_id ?? row.test_run_id
      map.set(key, [...(map.get(key) ?? []), row])
    }
    return map
  }, [evidence.data])
  const include = draft.data?.include_steps_without_evidence ?? false
  const model = useMemo(
    () => buildReportModel({ tree, evidence: evidence.data ?? [], items: items.data ?? [], includeStepsWithoutEvidence: include }),
    [tree, evidence.data, items.data, include],
  )
  const previewItems = evidence.data ?? []

  if (protocol.isPending || rows.isPending || role.isPending || evidence.isPending || draft.isPending) return <LoadingState label="Loading report builder…" />
  const loadError = protocol.error ?? rows.error ?? evidence.error ?? draft.error ?? items.error
  if (loadError) return <ErrorState message={toUserMessage(loadError)} onRetry={() => void Promise.all([protocol.refetch(), rows.refetch(), evidence.refetch(), draft.refetch(), items.refetch()])} />

  const isAdmin = !!profile?.is_admin
  if (!protocol.data || !roleAtLeast(role.data, 'manager', isAdmin)) {
    return (
      <EmptyState
        icon={LockIcon}
        title="Report builder not available"
        description="Building reports is for managers of this protocol and administrators."
        action={
          <Button asChild variant="outline">
            <Link to="/protocols">Back to protocols</Link>
          </Button>
        }
      />
    )
  }

  const p = protocol.data
  const busy = progress !== null
  const exportId = draft.data?.id

  /** Selected images of a group, in report order. */
  const orderedSelection = (group: Group) =>
    group.evidence
      .filter((row) => selected.has(row.id))
      .sort((a, b) => selected.get(a.id)!.position - selected.get(b.id)!.position || a.uploaded_at.localeCompare(b.uploaded_at))

  const fail = (error: unknown) => toast.error(toUserMessage(error))

  function setGroupSelection(groups: Group[], select: boolean) {
    const add: { evidenceId: string; position: number }[] = []
    const remove: string[] = []
    for (const group of groups) {
      let next = Math.max(0, ...orderedSelection(group).map((row) => selected.get(row.id)!.position))
      for (const row of group.evidence) {
        if (select && !selected.has(row.id)) add.push({ evidenceId: row.id, position: (next += 1) })
        if (!select && selected.has(row.id)) remove.push(row.id)
      }
    }
    if (add.length || remove.length) mutations.select.mutate({ add, remove }, { onError: fail })
  }

  function move(group: Group, evidenceId: string, delta: number) {
    const order = orderedSelection(group).map((row) => row.id)
    const index = order.indexOf(evidenceId)
    const target = index + delta
    if (!exportId || target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target]!, order[index]!]
    mutations.reorder.mutate({ exportId, evidenceIds: order }, { onError: fail })
  }

  async function generate() {
    if (!exportId) return
    setGenerationError(null)
    setProgress({ phase: 'images', done: 0, total: model.counts.images })
    try {
      const name = (id: string) => directory.data?.get(id)?.display_name ?? 'Unknown user'
      const { blob, fileName, saveProblem } = await generateReport({
        exportId,
        protocolId,
        reference: p.reference,
        model,
        meta: {
          protocol: {
            name: p.name,
            reference: p.reference,
            version: p.version,
            status: PROTOCOL_STATUSES[p.status].label,
            description: p.description,
            createdBy: name(p.created_by),
            createdAt: formatDateTime(p.created_at),
          },
          generatedBy: profile?.display_name ?? 'Unknown user',
        },
        pageSize: settings.data?.pageSize ?? 'A4',
        longEdge: settings.data?.longEdge ?? 2000,
        saveCopy,
        onProgress: setProgress,
      })
      downloadBlob(blob, fileName)
      if (saveProblem) toast.warning('Report generated, copy not saved', { description: saveProblem, duration: 20_000 })
      else toast.success('Report generated', { description: saveCopy ? `${fileName} downloaded and saved to Generated Documents.` : `${fileName} downloaded.` })
      await mutations.continueInNewDraft.mutateAsync({ exportId, name: draft.data!.name })
    } catch (error) {
      setGenerationError(error instanceof Error && !('code' in error) ? error.message : toUserMessage(error))
    } finally {
      setProgress(null)
    }
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to={`/protocols/${protocolId}`}>
          <ArrowLeftIcon aria-hidden="true" />
          {p.reference} — {p.name}
        </Link>
      </Button>
      <PageHeader title="Report builder" description="Choose the evidence for the Word report. Your selection is saved as you go and can be resumed later." />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {(evidence.data ?? []).length === 0 ? (
            <EmptyState icon={ImagesIcon} title="No evidence in this protocol yet" description="Testers upload screenshots in each test run’s execution view. They appear here for selection." />
          ) : (
            tree.map((chapter) => {
              const chapterIds = chapterEvidence(chapter, byGroup).map((row) => row.id)
              const chapterGroups = chapter.functions.flatMap((fn) => fn.testRuns.flatMap((run) => runGroups(run, byGroup)))
              return (
                <section key={chapter.row.id} aria-label={`Chapter ${chapter.number} ${chapter.row.title}`} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">
                      {chapter.number}. {chapter.row.title}
                    </h2>
                    <TriStateCheckbox
                      id={`chapter-${chapter.row.id}`}
                      label="All in chapter"
                      ids={chapterIds}
                      selected={selected}
                      disabled={busy}
                      onChange={(select) => setGroupSelection(chapterGroups, select)}
                    />
                  </div>
                  {chapterIds.length === 0 ? <p className="text-sm text-muted-foreground">No evidence in this chapter.</p> : null}
                  {chapter.functions.map((fn) =>
                    fn.testRuns.map((run) => {
                      const groups = runGroups(run, byGroup)
                      if (!groups.length) return null
                      return (
                        <div key={run.row.id} className="space-y-3 rounded-md border bg-muted/20 p-3" aria-label={`Test run ${run.number} ${run.row.title}`} role="group">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-medium">
                              {fn.number} {fn.row.title} › {run.number} {run.row.title}
                            </h3>
                            <TriStateCheckbox
                              id={`run-${run.row.id}`}
                              label="All in test run"
                              ids={groups.flatMap((group) => group.evidence.map((row) => row.id))}
                              selected={selected}
                              disabled={busy}
                              onChange={(select) => setGroupSelection(groups, select)}
                            />
                          </div>
                          {groups.map((group) => {
                            const order = orderedSelection(group).map((row) => row.id)
                            return (
                              <div key={group.key} className="space-y-2">
                                <h4 className="truncate text-xs font-medium text-muted-foreground">{group.label}</h4>
                                <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
                                  {group.evidence.map((row) => (
                                    <SelectableEvidence
                                      key={`${row.id}-${selected.get(row.id)?.caption_override ?? ''}`}
                                      evidence={row}
                                      url={urls.data?.get(row.storage_path)}
                                      selected={selected.has(row.id)}
                                      order={selected.has(row.id) ? order.indexOf(row.id) + 1 : null}
                                      count={order.length}
                                      captionOverride={selected.get(row.id)?.caption_override ?? null}
                                      disabled={busy}
                                      onToggle={(select) => setGroupSelection([{ ...group, evidence: [row] }], select)}
                                      onPreview={() => setPreview(previewItems.findIndex((candidate) => candidate.id === row.id))}
                                      onCaption={(caption) => exportId && mutations.setCaption.mutate({ exportId, evidenceId: row.id, caption }, { onError: fail })}
                                      onMove={(delta) => move(group, row.id, delta)}
                                    />
                                  ))}
                                </ul>
                              </div>
                            )
                          })}
                        </div>
                      )
                    }),
                  )}
                </section>
              )
            })
          )}
        </div>

        <aside aria-label="Report summary" className="space-y-4 rounded-lg border p-4 lg:sticky lg:top-20">
          <div>
            <h2 className="font-semibold">{p.name}</h2>
            <p className="text-sm text-muted-foreground">
              {p.reference} · Version {p.version}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm" aria-live="polite">
            {[
              ['Chapters', model.counts.chapters],
              ['Test runs', model.counts.testRuns],
              ['Steps', model.counts.steps],
              ['Images selected', model.counts.images],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/50 p-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-1.5">
            <Label htmlFor="report-name">Report name</Label>
            <Input
              key={draft.data?.name}
              id="report-name"
              defaultValue={draft.data?.name ?? `${p.reference} test evidence report`}
              maxLength={200}
              disabled={busy}
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name && name !== draft.data?.name) mutations.updateDraft.mutate({ name }, { onError: fail })
              }}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="include-empty"
              checked={include}
              disabled={busy}
              onCheckedChange={(value) => mutations.updateDraft.mutate({ include_steps_without_evidence: value === true }, { onError: fail })}
            />
            <Label htmlFor="include-empty" className="text-sm font-normal">
              Include steps that have no selected evidence
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="save-copy" checked={saveCopy} disabled={busy} onCheckedChange={(value) => setSaveCopy(value === true)} />
            <Label htmlFor="save-copy" className="text-sm font-normal">
              Save a copy to Generated Documents
            </Label>
          </div>

          {progress ? (
            <div className="space-y-1" role="status">
              <p className="text-sm">
                {PHASE_TEXT[progress.phase]}
                {progress.phase === 'images' ? ` (${progress.done} of ${progress.total})` : '…'}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${progress.total ? (progress.phase === 'images' ? progress.done / progress.total : 1) * 100 : 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Keep this tab open until the download starts.</p>
            </div>
          ) : null}
          {generationError ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {generationError}
            </p>
          ) : null}

          <Button className="w-full" onClick={() => void generate()} disabled={busy || !exportId || model.chapters.length === 0}>
            <FileTextIcon aria-hidden="true" />
            {busy ? 'Generating…' : 'Generate Word report'}
          </Button>
          {model.chapters.length === 0 ? <p className="text-xs text-muted-foreground">Select at least one image, or include steps without evidence.</p> : null}
        </aside>
      </div>

      <EvidencePreviewDialog
        items={previewItems}
        index={preview}
        onIndexChange={setPreview}
        onClose={() => setPreview(null)}
        location={(row) => `${p.reference} › ${row.original_filename}`}
        permissions={{ userId: profile?.id ?? '', isAdmin, roleFor: () => role.data ?? null }}
      />
    </>
  )
}
