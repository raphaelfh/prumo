/**
 * Componente para gerenciar lista de valores permitidos
 * 
 * Features:
 * - Adicionar valor via input + botão
 * - Remover valor da lista
 * - Reordenar valores com drag-and-drop (@dnd-kit)
 * - Validação de duplicatas em tempo real
 * - Preview visual da lista
 * - Import/export (futuro)
 * 
 * @component
 */

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import {
  CSS,
} from '@dnd-kit/utilities';

interface AllowedValuesListProps {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  showReorder?: boolean; // Se deve mostrar drag-and-drop
}

interface SortableItemProps {
  id: string;
  value: string;
  index: number;
  onRemove: () => void;
  disabled?: boolean;
}

// Componente para item individual da lista (com drag-drop)
function SortableItem({ id, value, index, onRemove, disabled }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 bg-background rounded-md px-3 py-2 group hover:bg-accent transition-colors border",
        isDragging && "z-50 shadow-lg"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/40" />
      </div>
      <span className="flex-1 text-sm select-none">{value}</span>
      <Badge variant="secondary" className="text-xs">
        {index + 1}
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
        disabled={disabled}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function AllowedValuesList({
  values,
  onChange,
  disabled = false,
  showReorder = false,
}: AllowedValuesListProps) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Sensores para drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    
    // Validações
    if (!trimmed) {
      setError('Digite um valor');
      return;
    }

    if (values.includes(trimmed)) {
      setError('Este valor já foi adicionado');
      return;
    }

    if (values.length >= 100) {
      setError('Máximo de 100 valores permitidos');
      return;
    }

    // Adicionar valor
    onChange([...values, trimmed]);
    setInputValue('');
    setError(null);
  };

  const handleRemove = (index: number) => {
    const newValues = values.filter((_, i) => i !== index);
    onChange(newValues);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = values.findIndex((value) => `value-${value}` === active.id);
      const newIndex = values.findIndex((value) => `value-${value}` === over.id);

      const newValues = arrayMove(values, oldIndex, newIndex);
      onChange(newValues);
    }
  };

  return (
    <div className="space-y-3">
      {/* Input para adicionar */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Digite uma opção e pressione Enter ou clique +"
            disabled={disabled}
            className={cn(error && 'border-destructive')}
          />
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>
        <Button
          type="button"
          onClick={handleAdd}
          disabled={disabled || !inputValue.trim()}
          size="icon"
          variant="outline"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Lista de valores */}
      {values.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">
              Opções adicionadas ({values.length})
            </p>
          </div>
          
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {showReorder && values.length > 1 ? (
              // Lista com drag-and-drop
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={values.map((value) => `value-${value}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {values.map((value, index) => (
                    <SortableItem
                      key={`value-${value}`}
                      id={`value-${value}`}
                      value={value}
                      index={index}
                      onRemove={() => handleRemove(index)}
                      disabled={disabled}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              // Lista simples (sem drag-drop)
              values.map((value, index) => (
                <div
                  key={`${value}-${index}`}
                  className="flex items-center gap-2 bg-background rounded-md px-3 py-2 group hover:bg-accent transition-colors border"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                  <span className="flex-1 text-sm">{value}</span>
                  <Badge variant="secondary" className="text-xs">
                    {index + 1}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRemove(index)}
                    disabled={disabled}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Mensagem se vazio */}
      {values.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma opção adicionada ainda
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Digite acima e pressione <kbd className="px-1 py-0.5 bg-muted border rounded text-xs font-mono">Enter</kbd> ou clique <Plus className="h-3 w-3 inline" />
            {showReorder && " • Arraste para reordenar"}
          </p>
        </div>
      )}
    </div>
  );
}

