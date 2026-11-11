import { ArrowLeftIcon, LockIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { LoadingState } from '@/components/states/LoadingState'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { roleAtLeast } from '@/domain/roles'
import { FINAL_STEP_STATUSES, STEP_STATUSES } from '@/domain/status'
import { useRunEvidence, useUploadLimit, type EvidenceRow } from '@/features/evidence/api'
import { EvidenceGallery } from '@/features/evidence/EvidenceGallery'
import { EvidencePreviewDialog } from '@/features/evidence/EvidencePreviewDialog'
import { EvidenceUploader } from '@/features/evidence/EvidenceUploader'
import { RunResultCard } from '@/features/execution/RunResultCard'
import { StepResultCard } from '@/features/execution/StepResultCard'
import { useMyProtocolRole, useProtocol, useProtocolRows } from '@/features/protocols/structure-api'
import { effectiveStatus, findTestRun, flattenSteps, leafSteps, type StepNode } from '@/features/protocols/tree'
import { toUserMessage } from '@/lib/errors'

/** Depth of each step for indentation, in display order. */
function withDepth(steps: StepNode[], depth = 0): { step: StepNode; depth: number }[] {
  return steps.flatMap((step) => [{ step, depth }, ...withDepth(step.children, depth + 1)])
}

export function TestRunPage() {
  const { protocolId = '', runId = '' } = useParams()
  const { profile } = useAuth()
  const protocol = useProtocol(protocolId)
  const rows = useProtocolRows(protocolId)
  const role = useMyProtocolRole(protocolId)
  const evidence = useRunEvidence(runId)
  const uploadLimit = useUploadLimit()
  const [preview, setPreview] = useState<number | null>(null)

  const located = useMemo(() => findTestRun(rows.data, runId), [rows.data, runId])

  // Evidence in display order: run-level first, then by step order.
  const ordered = useMemo(() => {
    if (!located || !evidence.data) return []
    const stepOrder = flattenSteps(located.run.steps).map((step) => step.row.id)
    const rank = (row: EvidenceRow) => (row.test_step_id ? stepOrder.indexOf(row.test_step_id) + 1 : 0)
    return [...evidence.data].sort((a, b) => rank(a) - rank(b) || a.uploaded_at.localeCompare(b.uploaded_at))
  }, [located, evidence.data])

  if (protocol.isPending || rows.isPending || role.isPending) return <LoadingState label="Loading test run…" />
  if (protocol.isError || rows.isError) {
    return <ErrorState message={toUserMessage(protocol.error ?? rows.error)} onRetry={() => void Promise.all([protocol.refetch(), rows.refetch()])} />
  }
  if (!protocol.data || !located) {
    return (
      <EmptyState
        icon={LockIcon}
        title="Test run not available"
        description="This test run does not exist, is archived, or belongs to a protocol you are not assigned to."
        action={
          <Button asChild variant="outline">
            <Link to="/protocols">Back to protocols</Link>
          </Button>
        }
      />
    )
  }

  const { chapter, fn, run } = located
  const isAdmin = !!profile?.is_admin
  const canRecord = roleAtLeast(role.data, 'tester', isAdmin) && !protocol.data.deleted_at
  const steps = flattenSteps(run.steps)
  // Progress counts the steps whose status is recorded directly (no sub-steps).
  const liveSteps = steps.filter((step) => !step.row.deleted_at)
  // A run without steps carries its own result (ADR-018).
  const statuses = liveSteps.length ? leafSteps(run.steps).map((step) => step.row.status) : [run.row.status]
  const finished = statuses.filter((status) => FINAL_STEP_STATUSES.includes(status)).length
  const passed = statuses.filter((status) => status === 'passed').length
  const runEvidence = ordered.filter((row) => !row.test_step_id)
  const stepNumber = new Map(steps.map((step) => [step.row.id, step.number]))
  const location = (row: EvidenceRow) =>
    [
      protocol.data!.reference,
      `${chapter.number} ${chapter.row.title}`,
      `${fn.number} ${fn.row.title}`,
      `${run.number} ${run.row.title}`,
      row.test_step_id ? `Step ${stepNumber.get(row.test_step_id) ?? ''}` : 'Whole test run',
    ].join(' › ')
  const permissions = { userId: profile?.id ?? '', isAdmin, roleFor: () => role.data ?? null }
  const maxBytes = uploadLimit.data ?? 20 * 1024 * 1024
  const open = (row: EvidenceRow) => setPreview(ordered.findIndex((candidate) => candidate.id === row.id))

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to={`/protocols/${protocolId}`}>
          <ArrowLeftIcon aria-hidden="true" />
          {protocol.data.reference} — {protocol.data.name}
        </Link>
      </Button>
      <PageHeader
        title={`${run.number} ${run.row.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {chapter.number} {chapter.row.title} › {fn.number} {fn.row.title}
            </span>
            {run.row.reference ? <span className="font-mono">{run.row.reference}</span> : null}
            <StatusBadge status={STEP_STATUSES[effectiveStatus(run)]} />
            <span>
              {liveSteps.length ? `${finished} of ${statuses.length} steps executed · ${passed} passed` : 'No steps: result recorded on the test run'}
            </span>
          </span>
        }
      />
      {run.row.description ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{run.row.description}</p> : null}

      <section aria-labelledby="run-evidence" className="space-y-2 rounded-lg border p-4">
        <h2 id="run-evidence" className="font-semibold">
          Evidence for the whole test run ({runEvidence.length})
        </h2>
        <EvidenceGallery items={runEvidence} onOpen={(index) => open(runEvidence[index]!)} emptyText="No evidence attached to the test run as a whole." />
        {canRecord ? (
          <EvidenceUploader target={{ protocolId, testRunId: runId, testStepId: null }} maxBytes={maxBytes} label="Add evidence to the whole test run" />
        ) : null}
      </section>

      {liveSteps.length === 0 ? (
        <RunResultCard key={`${run.row.id}-${run.row.executed_at ?? ''}`} run={run.row} canRecord={canRecord} />
      ) : (
        <div className="space-y-3">
          {withDepth(run.steps).map(({ step, depth }) => (
            <StepResultCard
              key={`${step.row.id}-${step.row.executed_at ?? ''}`}
              step={step}
              depth={depth}
              canRecord={canRecord}
              evidence={ordered.filter((row) => row.test_step_id === step.row.id)}
              uploadTarget={{ protocolId, testRunId: runId, testStepId: step.row.id }}
              maxBytes={maxBytes}
              onOpenEvidence={open}
            />
          ))}
        </div>
      )}

      <EvidencePreviewDialog
        items={ordered}
        index={preview}
        onIndexChange={setPreview}
        onClose={() => setPreview(null)}
        location={location}
        permissions={permissions}
      />
    </>
  )
}
