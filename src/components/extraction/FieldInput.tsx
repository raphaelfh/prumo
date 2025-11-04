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
import { AISuggestionDisplay } from './ai/AISuggestionDisplay';
import { AISuggestionBadge } from './ai/AISuggestionBadge';
import { getRelatedUnits } from '@/lib/unitConversions';
import type { AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';
import {
  extractValue,
  isEmptyValue,
  isValidNumber,
  extractUnit,
} from '@/lib/ai-extraction/valueParser';
import { isSuggestionPending } from '@/lib/ai-extraction/suggestionUtils';

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
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  disabled?: boolean;
  viewMode?: 'extract' | 'compare';
}

// =================== COMPONENT ===================

export function FieldInput(props: FieldInputProps) {
  const { field, instanceId, value, onChange, disabled, otherExtractions, aiSuggestion, onAcceptAI, onRejectAI, getSuggestionsHistory, isActionLoading, viewMode } = props;
  const [validationError, setValidationError] = useState<string | null>(null);
  
  // Espaçamento fixo confortável
  const containerPadding = 'py-6';
  const inputHeight = 'h-11';
  const inputPadding = 'px-4 py-2.5';
  const gap = 'gap-6';

  // Se houver sugestão pendente, mostrar o valor sugerido no campo para o usuário decidir
  // Prioridade: valor manual existente > sugestão pendente > vazio
  const hasAIPending = aiSuggestion ? isSuggestionPending(aiSuggestion) : false;
  const hasAIAccepted = aiSuggestion ? aiSuggestion.status === 'accepted' : false;
  const hasManualValue = !isEmptyValue(value);
  
  // Se não tem valor manual E tem sugestão pendente, usar o valor sugerido
  // Se aceita, também mostrar o valor sugerido (mas badge mostra "IA aceita")
  const displayValue = hasManualValue 
    ? value 
    : ((hasAIPending || hasAIAccepted) && aiSuggestion?.value !== null && aiSuggestion?.value !== undefined)
      ? aiSuggestion.value
      : (value ?? '');

  // Validação básica
  const validateValue = (val: any): boolean => {
    // Para campos obrigatórios, verificar se o valor não está vazio
    if (field.is_required) {
      if (isEmptyValue(val)) {
        setValidationError('Campo obrigatório');
        return false;
      }
    }

    if (field.field_type === 'number') {
      // Se tem valor mas não é um número válido
      if (!isEmptyValue(val) && !isValidNumber(val)) {
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
                "text-base min-h-[100px]",
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
                inputHeight,
                "text-base",
                hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10",
                validationError && "border-destructive"
              )}
          />
        );

      case 'number':
        // Parse valor (pode ser objeto {value, unit} ou valor simples)
        const numValue = extractValue(displayValue);
        const currentUnit = extractUnit(displayValue) 
          ?? (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit);
        
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
              className={cn("flex-1", inputHeight, "text-base", validationError && "border-destructive")}
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
            className={cn(inputHeight, "text-base", validationError && "border-destructive")}
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
            <SelectTrigger className={cn(inputHeight, "text-base", validationError && "border-destructive")}>
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
            className={cn(inputHeight, "text-base", validationError && "border-destructive")}
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
            className={cn(inputHeight, "text-base", validationError && "border-destructive")}
          />
        );
    }
  };

  // Determinar se deve mostrar display de sugestão abaixo do input (Opção F: Máxima Simplicidade)
  // Mostrar apenas se não há valor manual E sugestão existe e está pending (não aceita)
  // Quando aceita, o badge permanece visível mas o display com botões desaparece
  const shouldShowSuggestion = !hasManualValue && 
    aiSuggestion && 
    aiSuggestion.status === 'pending'; // Apenas pending mostra botões e valor abaixo

  return (
    <div className={cn("grid grid-cols-[30%_1fr] items-start", gap, containerPadding)}>
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
      <div className="space-y-2 min-w-0 overflow-hidden">
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

        {/* Input com badge + info ao lado direito (sempre visível se houver sugestão) */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            {renderInput()}
          </div>
          
          {/* Badge + Info sempre visíveis ao lado direito do input (se houver sugestão e não rejeitada) */}
          {aiSuggestion && 
           aiSuggestion.status !== 'rejected' && 
           (aiSuggestion.status === 'pending' || aiSuggestion.status === 'accepted') && (
            <AISuggestionBadge
              instanceId={instanceId}
              fieldId={field.id}
              suggestion={aiSuggestion}
              getHistory={getSuggestionsHistory}
            />
          )}
        </div>

        {/* Valor sugerido + botões aceitar/rejeitar abaixo do input - apenas se não há valor manual (Opção F) */}
        {shouldShowSuggestion && (
          <AISuggestionDisplay
            suggestion={aiSuggestion}
            onAccept={onAcceptAI}
            onReject={onRejectAI}
            loading={isActionLoading ? isActionLoading(instanceId, field.id) === 'accept' || isActionLoading(instanceId, field.id) === 'reject' : false}
          />
        )}

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
  const aiSuggestionChanged = prevProps.aiSuggestion?.id !== nextProps.aiSuggestion?.id ||
                                prevProps.aiSuggestion?.status !== nextProps.aiSuggestion?.status;
  
  return (
    prevProps.field.id === nextProps.field.id &&
    prevProps.instanceId === nextProps.instanceId &&
    prevProps.value === nextProps.value &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.viewMode === nextProps.viewMode &&
    !aiSuggestionChanged // Re-renderizar se sugestão mudar (status ou ID)
  );
});

