import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from '@/components/StatusBadge'
import { PROTOCOL_STATUSES, STEP_STATUSES } from '@/domain/status'

describe('StatusBadge', () => {
  it('shows the label as text and the tone as a colour', () => {
    render(<StatusBadge status={STEP_STATUSES.failed} />)
    const badge = screen.getByText('Failed')
    expect(badge).toHaveAttribute('data-tone', 'danger')
  })

  it('has a distinct label for every step status', () => {
    const labels = Object.values(STEP_STATUSES).map((status) => status.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toEqual(['Not Started', 'In Progress', 'Passed', 'Failed', 'Blocked', 'Not Applicable'])
  })

  it('covers every protocol status from the data model (archived is the soft-deleted state, ADR-015)', () => {
    expect(Object.keys(PROTOCOL_STATUSES)).toEqual(['draft', 'active', 'completed'])
  })
})
