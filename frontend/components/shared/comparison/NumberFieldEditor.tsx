/**
 * Inline editor for numeric fields with unit support
 *
 * Pure presentation component - only manages editor UI.
 *
 * Features:
 * - 50/50 layout between input and select
 * - Tab navigation: Input → Select → Shift+Tab back
 * - Controlled Select state (notifies parent when open/close)
 * - StopPropagation to avoid click conflicts
 *
 * ARCHITECTURE (Separation of Concerns):
 * - NumberFieldEditor: Only renders and notifies changes
 * - ComparisonCell (parent): Manages lifecycle (open/close/save)
 * - Input blur: Silent (does not save)
 * - Click outside: Detected by parent via handleClickOutside
 * - Enter/Escape: Notifies parent via onSave/onCancel
 */

import {useEffect, useRef, useState} from 'react';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Badge} from '@/components/ui/badge';
import {getRelatedUnits} from '@/lib/unitConversions';
import type {ExtractionField} from '@/types/extraction';

interface NumberFieldEditorProps {
    value: any; // Can be "100" or { value: "100", unit: "years" }
  field: ExtractionField;
  onChange: (newValue: any) => void;
  onSave: () => void;
  onCancel: () => void;
    onSelectOpenChange?: (open: boolean) => void; // Callback for Select open state
  autoFocus?: boolean;
}

export function NumberFieldEditor(props: NumberFieldEditorProps) {
  const { value, field, onChange, onSave, onCancel, onSelectOpenChange, autoFocus } = props;

    // Parse initial value
  const initialNumValue = typeof value === 'object' && value !== null && 'value' in value
    ? value.value
    : value;
  
  const initialUnit = typeof value === 'object' && value !== null && 'unit' in value
    ? value.unit
    : (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit);

  const [numValue, setNumValue] = useState(initialNumValue || '');
  const [currentUnit, setCurrentUnit] = useState(initialUnit || '');
    const [_isSelectOpen, setIsSelectOpen] = useState(false); // Internal state to track Select
  const selectTriggerRef = useRef<HTMLButtonElement>(null);

    // Determine available units
  const availableUnits = field.allowed_units && field.allowed_units.length > 0
    ? field.allowed_units
    : (field.unit ? getRelatedUnits(field.unit) : []);

  const hasMultipleUnits = availableUnits.length > 1;
  const hasSingleUnit = availableUnits.length === 1;

    // Update value on onChange
  useEffect(() => {
    if (availableUnits.length > 0) {
      onChange({ value: numValue, unit: currentUnit });
    } else {
      onChange(numValue);
    }
  }, [numValue, currentUnit]);

  // ✅ Handler de teclado com suporte a Tab
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey && hasMultipleUnits) {
      e.preventDefault();
      // Focar no Select
      selectTriggerRef.current?.focus();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  // ✅ Blur do Input: NÃO salva automaticamente
  // O ComparisonCell é responsável por detectar cliques fora e salvar
  // Aqui apenas prevenimos blur quando navegando dentro do editor
  const handleInputBlur = (e: React.FocusEvent) => {
    // Silenciar blur - não fazer nada
    // O ComparisonCell vai detectar clique fora e chamar onSave()
    void e;
  };

    // Callback for Select state
  const handleSelectOpenChange = (open: boolean) => {
      setIsSelectOpen(open); // Update internal state
    onSelectOpenChange?.(open); // ✅ Propagar para ComparisonCell
  };

  return (
    <div 
      className="flex gap-2 items-center w-full min-w-[200px]"
      onClick={(e) => e.stopPropagation()} // ✅ Prevenir fechamento ao clicar
    >
      <Input
        type="number"
        value={numValue}
        onChange={(e) => setNumValue(e.target.value)}
        onBlur={handleInputBlur}
        onKeyDown={handleInputKeyDown}
        autoFocus={autoFocus}
        className="h-8 text-sm w-1/2 min-w-[80px]"
        placeholder="0"
      />
      
      {/* Seletor de unidade (se múltiplas disponíveis) */}
      {hasMultipleUnits && (
        <Select
          value={currentUnit}
          onValueChange={setCurrentUnit}
          onOpenChange={handleSelectOpenChange} // ✅ NOVO: controle de estado
        >
          <SelectTrigger 
            ref={selectTriggerRef} // ✅ NOVO: ref para focar via Tab
            className="w-1/2 h-8 text-sm min-w-[100px]"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onCancel();
              }
            }}
          >
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            {availableUnits.map((unit, index) => (
              <SelectItem key={unit} value={unit}>
                {unit}
                {index === 0 && field.allowed_units && field.allowed_units.length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">(padrão)</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      
      {/* Badge fixo (se apenas 1 unidade) */}
      {hasSingleUnit && (
        <Badge variant="outline" className="w-1/2 text-xs text-center min-w-[100px]">
          {availableUnits[0]}
        </Badge>
      )}
    </div>
  );
}
