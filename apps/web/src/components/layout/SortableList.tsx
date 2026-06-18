/**
 * SortableList — thin @dnd-kit wrapper for the sidebar's drag-to-reorder lists
 * (workspaces, chats). Whole-item drag with a 6px activation distance, so a
 * plain click still navigates and only a deliberate drag reorders. Pair each
 * child with <SortableItem id={…}>. The owner persists order via onReorder.
 */
import type { ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableList<T>({
  items,
  getId,
  onReorder,
  children,
}: {
  items: T[];
  getId: (item: T) => string;
  /** Called on drop with the new array + the moved id and its new index. */
  onReorder: (reordered: T[], movedId: string, toIndex: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to), String(active.id), to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // Suppress native HTML5 drag of child links/images (ghost image).
      onDragStart={(e) => e.preventDefault()}
      className={className}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
        position: "relative",
        zIndex: isDragging ? 20 : undefined,
        touchAction: "none",
      }}
    >
      {children}
    </div>
  );
}

/**
 * The new sort_order for an item dropped at `toIndex` in `reordered`: the
 * midpoint of its new neighbours' effective order (their sort_order, or the
 * recency/creation fallback when unset). One write per drag, no renumbering.
 */
export function midpointSortOrder<T>(
  reordered: T[],
  toIndex: number,
  effective: (item: T) => number,
): number {
  const before = reordered[toIndex - 1];
  const after = reordered[toIndex + 1];
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return effective(after!) - 1;
  if (after === undefined) return effective(before) + 1;
  return (effective(before) + effective(after!)) / 2;
}
