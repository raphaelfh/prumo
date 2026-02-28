/**
 * Célula individual da tabela de comparação
 * 
 * Componente atômico que renderiza uma célula com:
 * - Formatação consistente
 * - Highlight de match/divergência
 * - Badge de consenso
 * - Edição inline (se editable e current user)
 * 
 * @component
 */

import {useEffect, useRef, useState} from 'react';
import {TableCell} from '@/components/ui/table';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {Check, Edit2} from 'lucide-react';
import {cn} from '@/lib/utils';
import {formatComparisonValue} from '@/lib/comparison/formatters';
import {NumberFieldEditor} from './NumberFieldEditor';
import type {ConsensusResult} from '@/lib/comparison/consensus';
import type {ExtractionField} from '@/types/extraction';

interface ComparisonCellProps {
  value: any;
  isCurrentUser: boolean;
  matches: boolean;
  consensus: ConsensusResult | null;
  onClick?: () => void;
  onValueChange?: (newValue: any) => void;
  formatValue?: (value: any) => string;
  editable?: boolean; // Se permite edição inline
  className?: string;
  field?: ExtractionField; // ✅ NOVO: informações do campo para edição especializada
}

/**
 * Célula da tabela de comparação
 * 
 * Visual states:
 * - Current user: fundo azul claro
 * - Match com current user: fundo verde
 * - Editável: mostra ícone de edição no hover
 * - Valor consensual: badge com contagem
 */
export function ComparisonCell({
  value,
  isCurrentUser,
  matches,
  consensus,
  onClick,
  onValueChange,
  formatValue,
  editable = false,
  className,
  field
}: ComparisonCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const formatter = formatValue || formatComparisonValue;
  const formattedValue = formatter(value);
  const isConsensusValue = consensus?.value === formattedValue;

  const canEdit = isCurrentUser && editable && onValueChange;
  
  // ✅ NOVO: Detectar se é campo numérico
  const isNumberField = field?.field_type === 'number';

  // ✅ NOVO: Detectar clique fora do editor
  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (event: MouseEvent) => {
      // ✅ NOVO: Não fechar se Select está aberto
      if (isSelectOpen) return;
      
      const target = event.target as HTMLElement;
      
      // ✅ NOVO: Ignorar cliques em portals do Radix UI (Select dropdown)
      if (target.closest('[data-radix-select-content]') || 
          target.closest('[data-radix-select-viewport]')) {
        return;
      }
      
      if (editorRef.current && !editorRef.current.contains(target)) {
        handleSave();
      }
    };

    // Adicionar listener com delay para não fechar imediatamente
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditing, editValue, value, onValueChange, isSelectOpen]);

  const handleSave = () => {
    if (editValue !== value && onValueChange) {
      onValueChange(editValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <TableCell
      className={cn(
        "font-mono text-sm transition-colors group relative",
        isCurrentUser && "bg-blue-50/50 dark:bg-blue-950/10",
        matches && !isCurrentUser && "bg-green-50 dark:bg-green-950/20 border-l-2 border-l-green-400",
        canEdit && !isEditing && "hover:bg-blue-100/70 cursor-pointer",
        onClick && "cursor-pointer hover:bg-muted/50",
        isEditing && "min-w-[250px]", // ✅ NOVO: dar mais espaço quando editando
        className
      )}
      onClick={canEdit && !isEditing ? () => setIsEditing(true) : onClick}
      role={canEdit || onClick ? "button" : undefined}
      tabIndex={canEdit || onClick ? 0 : undefined}
    >
      <div className="flex items-center gap-2" ref={editorRef}>
        {/* Modo edição (current user + editable) */}
        {isEditing ? (
          isNumberField && field ? (
            // ✅ NOVO: Editor especializado para números com unidade
            <NumberFieldEditor
              value={editValue}
              field={field}
              onChange={setEditValue}
              onSave={handleSave}
              onCancel={handleCancel}
              onSelectOpenChange={setIsSelectOpen}
              autoFocus
            />
          ) : (
            // Editor padrão (text, select, etc)
            <Input
              value={editValue || ''}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
              className="h-8 text-sm"
            />
          )
        ) : (
          <>
            <span className={cn(
              "truncate max-w-[120px]",
              formattedValue === '—' && "text-muted-foreground italic"
            )}>
              {formattedValue}
            </span>
            
            {/* Ícone de edição (hover - current user only) */}
            {canEdit && (
              <Edit2 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
            
            {/* Ícone de match (quando valor igual ao do current user) */}
            {matches && !isCurrentUser && (
              <Check className="h-4 w-4 text-green-600 shrink-0" aria-label="Valor igual" />
            )}
            
            {/* Badge de consenso (quando é o valor consensual) */}
            {isConsensusValue && consensus && consensus.count > 1 && (
              <Badge variant="secondary" className="text-xs shrink-0" title={`${consensus.count} de ${consensus.total} usuários`}>
                {consensus.count}
              </Badge>
            )}
          </>
        )}
      </div>
    </TableCell>
  );
}

