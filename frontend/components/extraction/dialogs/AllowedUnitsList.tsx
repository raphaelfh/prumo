/**
 * Componente para gerenciar lista de unidades alternativas
 * 
 * Features:
 * - Adicionar unidade via input + botão
 * - Sugestões de unidades comuns (integrado com UnitEditor)
 * - Remover unidade da lista
 * - Reordenar unidades (primeira é a padrão)
 * - Validação de duplicatas em tempo real
 * - Preview visual da lista
 * - Indicador visual da unidade padrão (primeira da lista)
 * 
 * @component
 */

import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {ChevronDown, GripVertical, Plus, Star, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Popover, PopoverContent, PopoverTrigger,} from '@/components/ui/popover';
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem,} from '@/components/ui/command';

interface AllowedUnitsListProps {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

// Unidades comuns organizadas por categoria (copiado de UnitEditor)
const COMMON_UNITS = {
  'Tempo': [
    'segundos', 'minutos', 'horas', 'dias', 'semanas', 'meses', 'anos'
  ],
  'Peso/Massa': [
    'mg', 'g', 'kg', 'libras', 'onças'
  ],
  'Dimensão': [
    'mm', 'cm', 'm', 'km', 'polegadas', 'pés'
  ],
  'Volume': [
    'ml', 'l', 'galões'
  ],
  'Pressão': [
    'mmHg', 'kPa', 'atm'
  ],
  'Temperatura': [
    '°C', '°F', 'K'
  ],
  'Porcentagem/Score': [
    '%', 'pontos', 'score', 'escala'
  ],
  'Frequência': [
    'Hz', 'bpm', 'por minuto', 'por hora', 'por dia'
  ],
  'Outros': [
    'unidades', 'doses', 'ciclos', 'episódios'
  ],
};

export function AllowedUnitsList({
  values,
  onChange,
  disabled = false,
}: AllowedUnitsListProps) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const handleAdd = (unit?: string) => {
    const trimmed = unit || inputValue.trim();
    
    // Validações
    if (!trimmed) {
      setError('Digite uma unidade');
      return;
    }

    if (values.includes(trimmed)) {
      setError('Esta unidade já foi adicionada');
      return;
    }

    if (values.length >= 20) {
      setError('Máximo de 20 unidades alternativas');
      return;
    }

    // Adicionar unidade
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

  const handleSelectSuggestion = (unit: string) => {
    handleAdd(unit);
    setOpen(false);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newValues = [...values];
    [newValues[index - 1], newValues[index]] = [newValues[index], newValues[index - 1]];
    onChange(newValues);
  };

  const handleMoveDown = (index: number) => {
    if (index === values.length - 1) return;
    const newValues = [...values];
    [newValues[index], newValues[index + 1]] = [newValues[index + 1], newValues[index]];
    onChange(newValues);
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
            placeholder="Digite uma unidade (ex: anos, kg, %) ou escolha das sugestões"
            disabled={disabled}
            className={cn(error && 'border-destructive', 'font-mono')}
          />
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>
        
        {/* Botão de sugestões */}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="w-[100px]"
            >
              Sugestões
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[250px] p-0" align="end">
            <Command>
              <CommandInput placeholder="Buscar unidade..." />
              <CommandEmpty>Nenhuma unidade encontrada</CommandEmpty>
              
              {Object.entries(COMMON_UNITS).map(([category, units]) => (
                <CommandGroup key={category} heading={category}>
                  {units.map((unit) => (
                    <CommandItem
                      key={unit}
                      onSelect={() => handleSelectSuggestion(unit)}
                      className="cursor-pointer"
                      disabled={values.includes(unit)}
                    >
                      <span className="font-mono text-sm">{unit}</span>
                      {values.includes(unit) && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          Adicionado
                        </Badge>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </Command>
          </PopoverContent>
        </Popover>
        
        <Button
          type="button"
          onClick={() => handleAdd()}
          disabled={disabled || !inputValue.trim()}
          size="icon"
          variant="outline"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Lista de unidades */}
      {values.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">
              Unidades disponíveis ({values.length})
            </p>
            <p className="text-xs text-muted-foreground">
              <Star className="h-3 w-3 inline mr-1" />
              Primeira é a padrão
            </p>
          </div>
          
          <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
            {values.map((unit, index) => (
              <div
                key={`${unit}-${index}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 group transition-colors border",
                  index === 0 
                    ? "bg-primary/5 border-primary/20" 
                    : "bg-background hover:bg-accent"
                )}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                
                {index === 0 && (
                  <Star className="h-3 w-3 text-primary flex-shrink-0" />
                )}
                
                <span className={cn(
                  "flex-1 text-sm font-mono",
                  index === 0 && "font-semibold"
                )}>
                  {unit}
                </span>
                
                {index === 0 && (
                  <Badge variant="default" className="text-xs">
                    Padrão
                  </Badge>
                )}
                
                {/* Botões de reordenar */}
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleMoveUp(index)}
                    disabled={disabled || index === 0}
                    title="Mover para cima"
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleMoveDown(index)}
                    disabled={disabled || index === values.length - 1}
                    title="Mover para baixo"
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => handleRemove(index)}
                    disabled={disabled}
                    title="Remover"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          
          {/* Preview de como aparecerá */}
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Preview na extração:
            </p>
            <div className="flex items-center gap-2 text-xs bg-background rounded-md border px-2 py-1.5">
              <span className="text-muted-foreground">Valor:</span>
              <input 
                type="text" 
                className="w-20 px-2 py-1 border rounded text-xs" 
                placeholder="123"
                disabled
              />
              <select className="px-2 py-1 border rounded text-xs font-mono" disabled>
                {values.map((unit, idx) => (
                  <option key={idx}>{unit}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Mensagem se vazio */}
      {values.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma unidade configurada
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Deixe vazio para usar sugestões automáticas baseadas no contexto,
            ou adicione unidades customizadas acima. A primeira unidade será a padrão.
          </p>
        </div>
      )}
    </div>
  );
}

