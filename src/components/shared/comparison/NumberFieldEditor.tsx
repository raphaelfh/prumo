/**
 * Editor inline para campos numéricos com suporte a unidades
 * 
 * Componente de apresentação puro - gerencia apenas a UI do editor.
 * 
 * Features:
 * - Layout 50/50 entre input e select
 * - Navegação por Tab: Input → Select → Shift+Tab volta
 * - Estado controlado do Select (notifica pai quando abre/fecha)
 * - StopPropagation para evitar conflitos de clique
 * 
 * ARQUITETURA (Separation of Concerns):
 * - NumberFieldEditor: Apenas renderiza e notifica mudanças
 * - ComparisonCell (pai): Gerencia ciclo de vida (abrir/fechar/salvar)
 * - Blur do Input: Silencioso (não salva)
 * - Clique fora: Detectado pelo pai via handleClickOutside
 * - Enter/Escape: Notifica pai via onSave/onCancel
 */

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { getRelatedUnits } from '@/lib/unitConversions';
import type { ExtractionField } from '@/types/extraction';

interface NumberFieldEditorProps {
  value: any; // Pode ser "100" ou { value: "100", unit: "years" }
  field: ExtractionField;
  onChange: (newValue: any) => void;
  onSave: () => void;
  onCancel: () => void;
  onSelectOpenChange?: (open: boolean) => void; // ✅ Callback para estado do Select
  autoFocus?: boolean;
}

export function NumberFieldEditor(props: NumberFieldEditorProps) {
  const { value, field, onChange, onSave, onCancel, onSelectOpenChange, autoFocus } = props;

  // Parse valor inicial
  const initialNumValue = typeof value === 'object' && value !== null && 'value' in value
    ? value.value
    : value;
  
  const initialUnit = typeof value === 'object' && value !== null && 'unit' in value
    ? value.unit
    : (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit);

  const [numValue, setNumValue] = useState(initialNumValue || '');
  const [currentUnit, setCurrentUnit] = useState(initialUnit || '');
  const [isSelectOpen, setIsSelectOpen] = useState(false); // ✅ State interno para rastrear Select
  const selectTriggerRef = useRef<HTMLButtonElement>(null);

  // Determinar unidades disponíveis
  const availableUnits = field.allowed_units && field.allowed_units.length > 0
    ? field.allowed_units
    : (field.unit ? getRelatedUnits(field.unit) : []);

  const hasMultipleUnits = availableUnits.length > 1;
  const hasSingleUnit = availableUnits.length === 1;

  // Atualizar valor no onChange
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

  // ✅ Callback para estado do Select
  const handleSelectOpenChange = (open: boolean) => {
    setIsSelectOpen(open); // ✅ Atualizar state interno
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
