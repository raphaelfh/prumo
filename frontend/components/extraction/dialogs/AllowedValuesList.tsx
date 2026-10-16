/**
 * Editor for a select field's options (`{value, label}`).
 *
 * - Add: the trimmed input becomes both the label and the stored value.
 * - Rename: click a label to edit it inline; Enter or blur commits, Escape
 *   cancels, and Enter or Escape hands focus back to the label. Only the label
 *   changes, so recorded answers (which store the value) stay attached.
 * - Remove, and reorder with drag-and-drop (@dnd-kit) when `showReorder`.
 *
 * A label equal to any option's value or label is refused, so a code and a
 * label can never be confused.
 */

import {useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type Ref} from 'react';
import {Input} from '@/components/ui/input';
import {IconButton} from '@/components/patterns/IconButton';
import {Badge} from '@/components/ui/badge';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {GripVertical, Plus, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import type {OptionItem} from '@/lib/extraction/options';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {CSS,} from '@dnd-kit/utilities';

const MAX_OPTIONS = 100;

interface AllowedValuesListProps {
  options: OptionItem[];
  onChange: (options: OptionItem[]) => void;
  disabled?: boolean;
  /** Show drag-and-drop reordering. */
  showReorder?: boolean;
  /** Focus the add-option input on mount (inspector deep-link, B-5). */
  autoFocusInput?: boolean;
}

/** An inline label edit in progress, keyed by the option's stable value. */
interface LabelEdit {
  value: string;
  draft: string;
  error: string | null;
}

interface OptionRowProps {
  option: OptionItem;
  index: number;
  disabled: boolean;
  edit: LabelEdit | null;
  onStartEdit: () => void;
  onEditChange: (draft: string) => void;
  /** Commits the draft; false when it was refused and the edit stays open. */
  onCommitEdit: () => boolean;
  onCancelEdit: () => void;
  onRemove: () => void;
  /** Drag wiring, present only in the sortable list. */
  sortable?: {
    setNodeRef: Ref<HTMLDivElement>;
    style: CSSProperties;
    isDragging: boolean;
    handleProps: HTMLAttributes<HTMLDivElement>;
  };
}

function OptionRow({
  option,
  index,
  disabled,
  edit,
  onStartEdit,
  onEditChange,
  onCommitEdit,
  onCancelEdit,
  onRemove,
  sortable,
}: OptionRowProps) {
  const labelButtonRef = useRef<HTMLButtonElement>(null);
  // Set by a keyboard close (Enter, Escape) so focus returns to the label; a
  // blur commit leaves focus wherever the user moved it.
  const refocusLabel = useRef(false);
  useEffect(() => {
    if (edit || !refocusLabel.current) return;
    refocusLabel.current = false;
    labelButtonRef.current?.focus();
  }, [edit]);

  return (
    <div
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      className={cn(
        'flex items-center gap-2 bg-background rounded-md px-3 py-2 group hover:bg-accent transition-colors border',
        sortable?.isDragging && 'z-50 shadow-lg',
      )}
    >
      {sortable ? (
        <div {...sortable.handleProps} className="cursor-grab active:cursor-grabbing">
          <GripVertical className="h-4 w-4 text-muted-foreground/40" />
        </div>
      ) : (
        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      )}
      {edit ? (
        <div className="flex-1 min-w-0">
          <Input
            autoFocus
            value={edit.draft}
            aria-label={t('templateConfig', 'optionLabelEdit')}
            aria-invalid={edit.error ? true : undefined}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                refocusLabel.current = onCommitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                refocusLabel.current = true;
                onCancelEdit();
              }
            }}
            onBlur={onCommitEdit}
            disabled={disabled}
            className={cn('h-7', edit.error && 'border-destructive')}
          />
          {edit.error && <p className="text-xs text-destructive mt-1">{edit.error}</p>}
        </div>
      ) : (
        <button
          ref={labelButtonRef}
          type="button"
          onClick={onStartEdit}
          disabled={disabled}
          aria-label={t('templateConfig', 'optionLabelEditNamed').replace('{{label}}', option.label)}
          className="flex-1 min-w-0 truncate text-left text-sm rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden"
        >
          {option.label}
        </button>
      )}
      <Badge variant="secondary" className="text-xs">
        {index + 1}
      </Badge>
      <IconButton
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
        disabled={disabled}
        label={t('extraction', 'optionRemove')}
        icon={<X />}
      />
    </div>
  );
}

type SortableOptionRowProps = Omit<OptionRowProps, 'sortable'>;

function SortableOptionRow(props: SortableOptionRowProps) {
  const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({
    id: props.option.value,
  });
  return (
    <OptionRow
      {...props}
      sortable={{
        setNodeRef,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.5 : 1,
        },
        isDragging,
        handleProps: {...attributes, ...listeners},
      }}
    />
  );
}

/** True when `label` collides with any option's value or label, `except` the one being renamed. */
function collides(options: OptionItem[], label: string, except?: string): boolean {
  return options.some((o) => o.value !== except && (o.value === label || o.label === label));
}

export function AllowedValuesList({
  options,
  onChange,
  disabled = false,
  showReorder = false,
  autoFocusInput = false,
}: AllowedValuesListProps) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [edit, setEditState] = useState<LabelEdit | null>(null);
  // Mirrors `edit` for the blur handler: a focused input that unmounts after
  // Enter or Escape may still fire blur with this render's stale closure.
  const editRef = useRef<LabelEdit | null>(null);
  const setEdit = (next: LabelEdit | null) => {
    editRef.current = next;
    setEditState(next);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAdd = () => {
    const label = inputValue.trim();
    if (!label) {
      setError(t('extraction', 'enterValue'));
      return;
    }
    if (collides(options, label)) {
      setError(t('extraction', 'valueAlreadyAdded'));
      return;
    }
    if (options.length >= MAX_OPTIONS) {
      setError(t('extraction', 'max100Values'));
      return;
    }
    onChange([...options, {value: label, label}]);
    setInputValue('');
    setError(null);
  };

  const commitEdit = () => {
    const edit = editRef.current;
    if (!edit) return false;
    const label = edit.draft.trim();
    if (!label) {
      setEdit({...edit, error: t('extraction', 'enterValue')});
      return false;
    }
    if (collides(options, label, edit.value)) {
      setEdit({...edit, error: t('extraction', 'valueAlreadyAdded')});
      return false;
    }
    setEdit(null);
    const current = options.find((o) => o.value === edit.value);
    if (current && current.label !== label) {
      onChange(options.map((o) => (o.value === edit.value ? {...o, label} : o)));
    }
    return true;
  };

  const handleRemove = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const {active, over} = event;
    if (over && active.id !== over.id) {
      const oldIndex = options.findIndex((o) => o.value === active.id);
      const newIndex = options.findIndex((o) => o.value === over.id);
      onChange(arrayMove(options, oldIndex, newIndex));
    }
  };

  const rowProps = (option: OptionItem, index: number): SortableOptionRowProps => ({
    option,
    index,
    disabled,
    edit: edit?.value === option.value ? edit : null,
    onStartEdit: () => setEdit({value: option.value, draft: option.label, error: null}),
    onEditChange: (draft) => setEdit({value: option.value, draft, error: null}),
    onCommitEdit: commitEdit,
    onCancelEdit: () => setEdit(null),
    onRemove: () => handleRemove(index),
  });

  return (
    <div className="space-y-3">
        {/* Input to add */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            value={inputValue}
            autoFocus={autoFocusInput}
            onChange={(e) => {
              setInputValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('extraction', 'placeholderOptions')}
            disabled={disabled}
            className={cn(error && 'border-destructive')}
          />
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>
        <IconButton
          onClick={handleAdd}
          disabled={disabled || !inputValue.trim()}
          variant="outline"
          label={t('extraction', 'optionAdd')}
          icon={<Plus />}
        />
      </div>

      {options.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">
                Options added ({options.length})
            </p>
          </div>

          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {showReorder && options.length > 1 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={options.map((o) => o.value)}
                  strategy={verticalListSortingStrategy}
                >
                  {options.map((option, index) => (
                    <SortableOptionRow key={option.value} {...rowProps(option, index)} />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              options.map((option, index) => (
                <OptionRow key={option.value} {...rowProps(option, index)} />
              ))
            )}
          </div>
        </div>
      )}

      {options.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
              {t('extraction', 'noOptionsAddedYet')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
              {t('extraction', 'typeAbovePressEnter')} <KbdBadge keys={['Enter']} /> <Plus
              className="h-3 w-3 inline"/>
              {showReorder && ` • ${t('extraction', 'dragToReorder')}`}
          </p>
        </div>
      )}
    </div>
  );
}
