import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { STEP_STATUSES, type StepStatus } from '@/domain/status'
import { structureKeys } from '@/features/protocols/structure-api'
import type { TestRunRow } from '@/features/protocols/tree'
import { useUserDirectory } from '@/features/users/api'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { getSupabase } from '@/lib/supabase'

const STATUS_ORDER = Object.keys(STEP_STATUSES) as StepStatus[]

/**
 * The result of a test run that has no steps (ADR-018): expected result from
 * the protocol, actual result, status and comments recorded by testers.
 */
export function RunResultCard({ run, canRecord }: { run: TestRunRow; canRecord: boolean }) {
  const queryClient = useQueryClient()
  const directory = useUserDirectory()
  const [actual, setActual] = useState(run.actual_result)
  const [status, setStatus] = useState<StepStatus>(run.status)
  const [comments, setComments] = useState(run.comments)
  const dirty = actual !== run.actual_result || status !== run.status || comments !== run.comments
  const executor = run.executed_by ? directory.data?.get(run.executed_by) : undefined

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await getSupabase().rpc('record_test_run_result', {
        p_test_run_id: run.id,
        p_actual_result: actual,
        p_status: status,
        p_comments: comments,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: structureKeys.rows(run.protocol_id) })
      toast.success('Test run result saved')
    },
    onError: (error) => toast.error(toUserMessage(error)),
  })

  return (
    <section aria-label="Test run result" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="font-semibold">Test run result</h2>
          <p className="text-sm text-muted-foreground">This test run has no steps, so its result is recorded here.</p>
        </div>
        <StatusBadge status={STEP_STATUSES[run.status]} />
      </div>

      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Expected result</div>
        <p className="whitespace-pre-wrap">{run.expected_result || '—'}</p>
      </div>

      {canRecord ? (
        <form
          className="grid gap-3 md:grid-cols-[1fr_12rem]"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="run-actual">Actual result</Label>
            <Textarea id="run-actual" rows={2} value={actual} onChange={(event) => setActual(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-status">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as StepStatus)}>
              <SelectTrigger id="run-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STEP_STATUSES[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="run-comments">Comments</Label>
            <Textarea id="run-comments" rows={1} value={comments} onChange={(event) => setComments(event.target.value)} />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save result'}
            </Button>
            {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Actual result</dt>
          <dd className="whitespace-pre-wrap">{run.actual_result || '—'}</dd>
          <dt className="text-muted-foreground">Comments</dt>
          <dd className="whitespace-pre-wrap">{run.comments || '—'}</dd>
        </dl>
      )}

      {run.executed_at ? (
        <p className="text-xs text-muted-foreground">
          Last recorded {formatDateTime(run.executed_at)}
          {executor ? ` by ${executor.display_name}` : ''}
        </p>
      ) : null}
    </section>
  )
}
