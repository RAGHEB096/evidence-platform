import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HandleProps = Record<string, unknown>
const HandleContext = createContext<{ props: HandleProps; enabled: boolean } | null>(null)

/**
 * One sibling list. Each list has its own DndContext, so items can only be
 * reordered among their siblings, never moved to another parent. Drag
 * announcements use the node labels rather than ids.
 */
export function SortableList({
  ids,
  labels,
  enabled,
  onReorder,
  children,
}: {
  ids: string[]
  labels: ReadonlyMap<string, string>
  enabled: boolean
  onReorder: (orderedIds: string[]) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const name = (id: UniqueIdentifier) => labels.get(String(id)) ?? 'item'
  const place = (id: UniqueIdentifier) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is at ${place(over.id)}.` : `${name(active.id)} is not over a valid position.`),
    onDragEnd: ({ active, over }) => (over ? `${name(active.id)} dropped at ${place(over.id)}.` : `${name(active.id)} dropped; order unchanged.`),
    onDragCancel: ({ active }) => `Moving ${name(active.id)} cancelled; order unchanged.`,
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!enabled || !over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }

  // Always provide a context, even when sorting is off: items still register
  // as droppables, and without their own context they would leak into the
  // parent list's context and become drop targets there.
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={!enabled}>
        <ul className="space-y-1">{children}</ul>
      </SortableContext>
    </DndContext>
  )
}

export function SortableItem({ id, enabled, children }: { id: string; enabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !enabled })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-80')}
    >
      <HandleContext.Provider value={{ props: { ...attributes, ...listeners }, enabled }}>{children}</HandleContext.Provider>
    </li>
  )
}

/** The grip. Drag with the pointer, or focus it and use Space plus arrow keys. */
export function DragHandle({ label }: { label: string }) {
  const context = useContext(HandleContext)
  if (!context?.enabled) return <span className="w-6 shrink-0" aria-hidden="true" />
  return (
    <button
      type="button"
      aria-label={`Drag to reorder ${label}`}
      className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
      {...context.props}
    >
      <GripVerticalIcon aria-hidden="true" className="size-4" />
    </button>
  )
}
