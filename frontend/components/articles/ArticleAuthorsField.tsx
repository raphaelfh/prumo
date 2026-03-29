import {useCallback} from 'react';
import {
    closestCenter,
    DndContext,
    type DragEndEvent,
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
import {CSS} from '@dnd-kit/utilities';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import {GripVertical, Minus, Plus, Rows2, SquareStack} from 'lucide-react';
import {t} from '@/lib/copy';
import type {AuthorFormRow} from '@/lib/articleAuthors';
import {newAuthorRow} from '@/lib/articleAuthors';

/** When switching single → person, split on first comma if present. */
function parsePersonFromSingle(single: string): Pick<AuthorFormRow, 'lastName' | 'firstName'> {
    const trimmed = single.trim();
    const idx = trimmed.indexOf(',');
    if (idx === -1) {
        return {lastName: trimmed, firstName: ''};
    }
    return {lastName: trimmed.slice(0, idx).trim(), firstName: trimmed.slice(idx + 1).trim()};
}

interface ArticleAuthorsFieldProps {
    rows: AuthorFormRow[];
    onChange: (rows: AuthorFormRow[]) => void;
    disabled?: boolean;
}

function SortableAuthorRow({
                               row,
                               onUpdate,
                               onRemove,
                               onInsertBelow,
                               onToggleMode,
                               disabled,
                           }: {
    row: AuthorFormRow;
    onUpdate: (id: string, patch: Partial<AuthorFormRow>) => void;
    onRemove: (id: string) => void;
    onInsertBelow: (id: string) => void;
    onToggleMode: (id: string) => void;
    disabled?: boolean;
}) {
    const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({
        id: row.id,
        disabled,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'flex items-start gap-1.5 rounded-md border border-border/50 bg-background px-1.5 py-1.5',
                isDragging && 'z-50 shadow-sm'
            )}
        >
            <button
                type="button"
                className="mt-1.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-grab active:cursor-grabbing disabled:opacity-40 disabled:pointer-events-none"
                aria-label={t('articles', 'authorDragHandleAria')}
                disabled={disabled}
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4"/>
            </button>

            <div className="min-w-0 flex-1 space-y-1.5">
                {row.mode === 'person' ? (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {t('articles', 'authorLastName')}
                            </Label>
                            <Input
                                value={row.lastName}
                                onChange={(e) => onUpdate(row.id, {lastName: e.target.value})}
                                placeholder={t('articles', 'authorLastNamePlaceholder')}
                                disabled={disabled}
                                className="h-8 text-[13px]"
                            />
                        </div>
                        <div>
                            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {t('articles', 'authorFirstName')}
                            </Label>
                            <Input
                                value={row.firstName}
                                onChange={(e) => onUpdate(row.id, {firstName: e.target.value})}
                                placeholder={t('articles', 'authorFirstNamePlaceholder')}
                                disabled={disabled}
                                className="h-8 text-[13px]"
                            />
                        </div>
                    </div>
                ) : (
                    <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t('articles', 'authorSingleField')}
                        </Label>
                        <Input
                            value={row.singleName}
                            onChange={(e) => onUpdate(row.id, {singleName: e.target.value})}
                            placeholder={t('articles', 'authorSinglePlaceholder')}
                            disabled={disabled}
                            className="h-8 text-[13px]"
                        />
                    </div>
                )}
            </div>

            <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => onToggleMode(row.id)}
                                disabled={disabled}
                                aria-label={t('articles', 'authorToggleModeAria')}
                            >
                                {row.mode === 'person' ? (
                                    <SquareStack className="h-3.5 w-3.5"/>
                                ) : (
                                    <Rows2 className="h-3.5 w-3.5"/>
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                            {row.mode === 'person'
                                ? t('articles', 'authorSwitchToSingle')
                                : t('articles', 'authorSwitchToPerson')}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(row.id)}
                    disabled={disabled}
                    aria-label={t('articles', 'authorRemoveAria')}
                >
                    <Minus className="h-3.5 w-3.5"/>
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onInsertBelow(row.id)}
                    disabled={disabled}
                    aria-label={t('articles', 'authorAddBelowAria')}
                >
                    <Plus className="h-3.5 w-3.5"/>
                </Button>
            </div>
        </div>
    );
}

export function ArticleAuthorsField({rows, onChange, disabled}: ArticleAuthorsFieldProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, {activationConstraint: {distance: 6}}),
        useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates})
    );

    const onDragEnd = useCallback(
        (event: DragEndEvent) => {
            const {active, over} = event;
            if (!over || active.id === over.id) return;
            const oldIndex = rows.findIndex((r) => r.id === active.id);
            const newIndex = rows.findIndex((r) => r.id === over.id);
            if (oldIndex < 0 || newIndex < 0) return;
            onChange(arrayMove(rows, oldIndex, newIndex));
        },
        [rows, onChange]
    );

    const updateRow = useCallback(
        (id: string, patch: Partial<AuthorFormRow>) => {
            onChange(rows.map((r) => (r.id === id ? {...r, ...patch} : r)));
        },
        [rows, onChange]
    );

    const removeRow = useCallback(
        (id: string) => {
            const next = rows.filter((r) => r.id !== id);
            onChange(next.length ? next : [newAuthorRow()]);
        },
        [rows, onChange]
    );

    const insertBelow = useCallback(
        (id: string) => {
            const i = rows.findIndex((r) => r.id === id);
            if (i < 0) return;
            const copy = [...rows];
            copy.splice(i + 1, 0, newAuthorRow());
            onChange(copy);
        },
        [rows, onChange]
    );

    const toggleMode = useCallback(
        (id: string) => {
            onChange(
                rows.map((r) => {
                    if (r.id !== id) return r;
                    if (r.mode === 'person') {
                        const combined = [r.lastName.trim(), r.firstName.trim()].filter(Boolean).join(' ');
                        return {
                            ...r,
                            mode: 'single' as const,
                            singleName: combined || r.singleName,
                            lastName: '',
                            firstName: '',
                        };
                    }
                    return {...r, ...parsePersonFromSingle(r.singleName), mode: 'person' as const, singleName: ''};
                })
            );
        },
        [rows, onChange]
    );

    const addAtEnd = useCallback(() => {
        onChange([...rows, newAuthorRow()]);
    }, [rows, onChange]);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('articles', 'authors')}
                </Label>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-muted-foreground"
                    onClick={addAtEnd}
                    disabled={disabled}
                >
                    <Plus className="mr-1 h-3 w-3"/>
                    {t('articles', 'authorAdd')}
                </Button>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1.5" role="list">
                        {rows.map((row) => (
                            <SortableAuthorRow
                                key={row.id}
                                row={row}
                                onUpdate={updateRow}
                                onRemove={removeRow}
                                onInsertBelow={insertBelow}
                                onToggleMode={toggleMode}
                                disabled={disabled}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
}
