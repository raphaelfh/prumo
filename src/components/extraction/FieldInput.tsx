/**
 * Input Universal de Campo de Extração
 * 
 * Componente que renderiza input apropriado baseado no tipo do campo:
 * - text: Input ou Textarea
 * - number: Input number + unit badge
 * - date: DatePicker
 * - select: Select dropdown
 * - multiselect: Multi-select
 * - boolean: Switch
 * 
 * Também mostra badges de IA e outras extrações (futuro).
 * 
 * @component
 */

import { useState, memo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExtractionField } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';
import { OtherExtractionsPopover } from './colaboracao/OtherExtractionsPopover';
import { OtherExtractionsButton } from './colaboracao/OtherExtractionsButton';
import { AISuggestionBadge } from './ai/AISuggestionBadge';
import { AIAcceptRejectButtons } from './ai/AIAcceptRejectButtons';
import { getRelatedUnits } from '@/lib/unitConversions';

// =================== INTERFACES ===================

interface FieldInputProps {
  field: ExtractionField;
  instanceId: string;
  value: any;
  onChange: (value: any) => void;
  projectId: string;
  articleId: string;
  otherExtractions?: OtherExtraction[];
  aiSuggestion?: AISuggestion;
  onAcceptAI?: () => void;
  onRejectAI?: () => void;
  disabled?: boolean;
  viewMode?: 'extract' | 'compare';
}

// =================== COMPONENT ===================

export function FieldInput(props: FieldInputProps) {
  const { field, instanceId, value, onChange, disabled, otherExtractions, aiSuggestion, onAcceptAI, onRejectAI, viewMode } = props;
  const [validationError, setValidationError] = useState<string | null>(null);

  // Usar sugestão de IA como valor inicial se não houver valor manual
  const hasAIPending = aiSuggestion?.status === 'pending';
  const displayValue = value ?? (hasAIPending ? aiSuggestion.value : '');

  // Validação básica
  const validateValue = (val: any): boolean => {
    // Para campos obrigatórios, verificar se o valor não está vazio
    if (field.is_required) {
      // Extrair valor do objeto {value, unit} se necessário
      const actualValue = typeof val === 'object' && val !== null && 'value' in val
        ? val.value
        : val;
        
      if (actualValue === null || actualValue === undefined || actualValue === '') {
        setValidationError('Campo obrigatório');
        return false;
      }
    }

    if (field.field_type === 'number') {
      // Extrair valor numérico do objeto {value, unit} se necessário
      const numericValue = typeof val === 'object' && val !== null && 'value' in val
        ? val.value
        : val;
      
      if (numericValue !== '' && numericValue !== null && numericValue !== undefined && isNaN(Number(numericValue))) {
        setValidationError('Valor deve ser um número');
        return false;
      }
    }

    setValidationError(null);
    return true;
  };

  const handleChange = (newValue: any) => {
    validateValue(newValue);
    onChange(newValue);
  };

  // Renderizar input baseado no tipo
  const renderInput = () => {
    switch (field.field_type) {
      case 'text':
        // Se description longa, usar textarea
        const isLongText = field.label.toLowerCase().includes('descrição') ||
                          field.label.toLowerCase().includes('justificativa') ||
                          field.label.toLowerCase().includes('comentário');
        
        if (isLongText) {
          return (
            <Textarea
              value={displayValue || ''}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={`Digite ${field.label.toLowerCase()}`}
              disabled={disabled}
              className={cn(
                "min-h-[100px] text-base",
                hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10",
                validationError && "border-destructive"
              )}
            />
          );
        }

        return (
          <Input
            value={displayValue || ''}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={`Digite ${field.label.toLowerCase()}`}
            disabled={disabled}
            className={cn(
              "h-11 text-base",
              hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10 pr-32",
              validationError && "border-destructive"
            )}
          />
        );

      case 'number':
        // Parse valor (pode ser objeto {value, unit} ou valor simples)
        const numValue = typeof displayValue === 'object' && displayValue !== null && 'value' in displayValue
          ? displayValue.value
          : displayValue;
        
        const currentUnit = typeof displayValue === 'object' && displayValue !== null && 'unit' in displayValue
          ? displayValue.unit
          : (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit);
        
        // Priorizar allowed_units customizadas sobre dicionário automático
        const relatedUnits = field.allowed_units && field.allowed_units.length > 0
          ? field.allowed_units // Usar unidades configuradas pelo manager (primeira é padrão)
          : (field.unit ? getRelatedUnits(field.unit) : []); // Fallback para dicionário automático
        
        const hasMultipleUnits = relatedUnits.length > 0;

        return (
          <div className="flex gap-2">
            <Input
              type="number"
              value={numValue || ''}
              onChange={(e) => {
                if (hasMultipleUnits) {
                  handleChange({ value: e.target.value, unit: currentUnit || field.unit });
                } else {
                  handleChange(e.target.value);
                }
              }}
              placeholder="0"
              disabled={disabled}
              className={cn("flex-1 h-11 text-base", validationError && "border-destructive")}
            />
            
            {/* Unit selector se houver unidades */}
            {hasMultipleUnits ? (
              <Select
                value={currentUnit || ''}
                onValueChange={(newUnit) => {
                  handleChange({ value: numValue, unit: newUnit });
                }}
                disabled={disabled}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Todas as unidades disponíveis (allowed_units ou relacionadas) */}
                  {relatedUnits.map((unit, index) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                      {index === 0 && field.allowed_units && field.allowed_units.length > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">(padrão)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit) ? (
              // Badge fixo se não houver múltiplas unidades mas houver uma unidade definida
              <Badge variant="outline" className="shrink-0 self-center">
                {field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit}
              </Badge>
            ) : null}
          </div>
        );

      case 'date':
        return (
          <Input
            type="date"
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className={cn("h-11 text-base", validationError && "border-destructive")}
          />
        );

      case 'select':
        const options = field.allowed_values as any[] || [];
        return (
          <Select 
            value={value || ''} 
            onValueChange={handleChange} 
            disabled={disabled}
          >
            <SelectTrigger className={cn("h-11 text-base", validationError && "border-destructive")}>
              <SelectValue placeholder={`Selecione ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option: any, index: number) => {
                const optionValue = typeof option === 'string' ? option : option.value;
                const optionLabel = typeof option === 'string' ? option : option.label || option.value;
                
                return (
                  <SelectItem key={index} value={optionValue}>
                    {optionLabel}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );

      case 'multiselect':
        // TODO: Implementar multi-select apropriado
        return (
          <Input
            value={Array.isArray(value) ? value.join(', ') : value || ''}
            onChange={(e) => handleChange(e.target.value.split(',').map(v => v.trim()))}
            placeholder="Valores separados por vírgula"
            disabled={disabled}
            className={cn("h-11 text-base", validationError && "border-destructive")}
          />
        );

      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={value || false}
              onCheckedChange={handleChange}
              disabled={disabled}
            />
            <span className="text-sm text-muted-foreground">
              {value ? 'Sim' : 'Não'}
            </span>
          </div>
        );

      default:
        return (
          <Input
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className={cn("h-11 text-base", validationError && "border-destructive")}
          />
        );
    }
  };

  return (
    <div className="grid grid-cols-[30%_1fr] gap-6 items-start py-6">
      {/* Coluna esquerda: Label + Description */}
      <div className="space-y-1 pt-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          {field.label}
          {field.is_required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {field.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {field.description}
          </p>
        )}
      </div>
      
      {/* Coluna direita: Input */}
      <div className="space-y-2">
        {/* Badges de colaboração - apenas no modo comparação */}
        {viewMode === 'compare' && otherExtractions && otherExtractions.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <OtherExtractionsPopover
              fieldId={field.id}
              instanceId={instanceId}
              extractions={otherExtractions}
              myValue={value}
            >
              <OtherExtractionsButton count={otherExtractions.length} />
            </OtherExtractionsPopover>
          </div>
        )}

        {/* Input com IA badges inline */}
        <div className="relative">
          {renderInput()}
          
          {/* IA Badge + Buttons (posição absoluta dentro do input) */}
          {hasAIPending && field.field_type === 'text' && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <AISuggestionBadge suggestion={aiSuggestion} />
              <AIAcceptRejectButtons
                onAccept={onAcceptAI}
                onReject={onRejectAI}
                size="sm"
              />
            </div>
          )}
        </div>

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {validationError}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Exporta versão memoizada para evitar re-renders desnecessários
 * 
 * Performance crítica: Só re-renderiza se valor DESTE campo específico mudou
 * Soluciona bug de input perdendo foco a cada caractere
 */
export default memo(FieldInput, (prevProps, nextProps) => {
  // Comparação otimizada: apenas props que afetam ESTE campo
  return (
    prevProps.field.id === nextProps.field.id &&
    prevProps.instanceId === nextProps.instanceId &&
    prevProps.value === nextProps.value &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.viewMode === nextProps.viewMode
    // NÃO comparar onChange, otherExtractions, aiSuggestion (não afetam render)
  );
});

