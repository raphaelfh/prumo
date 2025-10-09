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

import { useState } from 'react';
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
}

// =================== COMPONENT ===================

export function FieldInput(props: FieldInputProps) {
  const { field, instanceId, value, onChange, disabled, otherExtractions, aiSuggestion, onAcceptAI, onRejectAI } = props;
  const [validationError, setValidationError] = useState<string | null>(null);

  // Usar sugestão de IA como valor inicial se não houver valor manual
  const hasAIPending = aiSuggestion?.status === 'pending';
  const displayValue = value ?? (hasAIPending ? aiSuggestion.value : '');

  // Validação básica
  const validateValue = (val: any): boolean => {
    if (field.is_required && (val === null || val === undefined || val === '')) {
      setValidationError('Campo obrigatório');
      return false;
    }

    if (field.field_type === 'number' && val !== '' && isNaN(Number(val))) {
      setValidationError('Valor deve ser um número');
      return false;
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
                "min-h-[80px]",
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
              hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10 pr-32",
              validationError && "border-destructive"
            )}
          />
        );

      case 'number':
        return (
          <div className="flex gap-2">
            <Input
              type="number"
              value={value || ''}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="0"
              disabled={disabled}
              className={cn("flex-1", validationError && "border-destructive")}
            />
            {field.unit && (
              <Badge variant="outline" className="shrink-0 self-center">
                {field.unit}
              </Badge>
            )}
          </div>
        );

      case 'date':
        return (
          <Input
            type="date"
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className={cn(validationError && "border-destructive")}
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
            <SelectTrigger className={cn(validationError && "border-destructive")}>
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
            className={cn(validationError && "border-destructive")}
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
            className={cn(validationError && "border-destructive")}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      {/* Label */}
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          {field.label}
          {field.is_required && (
            <Badge variant="destructive" className="text-xs">
              Obrigatório
            </Badge>
          )}
        </Label>

        {/* Badges de colaboração */}
        <div className="flex items-center gap-2">
          {otherExtractions && otherExtractions.length > 0 && (
            <OtherExtractionsPopover
              fieldId={field.id}
              instanceId={instanceId}
              extractions={otherExtractions}
              myValue={value}
            >
              <OtherExtractionsButton count={otherExtractions.length} />
            </OtherExtractionsPopover>
          )}
        </div>
      </div>

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

      {/* Description */}
      {field.description && (
        <p className="text-xs text-muted-foreground">
          {field.description}
        </p>
      )}

      {/* Validation error */}
      {validationError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {validationError}
        </p>
      )}
    </div>
  );
}

