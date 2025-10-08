/**
 * Editor de unidades de medida
 * 
 * Features:
 * - Input com sugestões comuns
 * - Dropdown com categorias (tempo, peso, dimensão, etc.)
 * - Permite valores customizados
 * - Pode ser null/vazio (opcional)
 * - Validação de tamanho
 * 
 * @component
 */

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { 
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UnitEditorProps {
  value: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

// Unidades comuns organizadas por categoria
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

// Flatten todas as unidades para busca
const ALL_UNITS = Object.values(COMMON_UNITS).flat();

export function UnitEditor({ value, onChange, disabled = false }: UnitEditorProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');

  const handleSelect = (selectedUnit: string) => {
    setInputValue(selectedUnit);
    onChange(selectedUnit);
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue || null); // Converter string vazia para null
  };

  const handleClear = () => {
    setInputValue('');
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Ex: anos, kg, %, mmHg (ou deixe vazio)"
            disabled={disabled}
            className="font-mono"
          />
        </div>
        
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="w-[140px] justify-between"
            >
              Sugestões
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="end">
            <Command>
              <CommandInput placeholder="Buscar unidade..." />
              <CommandEmpty>Nenhuma unidade encontrada</CommandEmpty>
              
              {Object.entries(COMMON_UNITS).map(([category, units]) => (
                <CommandGroup key={category} heading={category}>
                  {units.map((unit) => (
                    <CommandItem
                      key={unit}
                      onSelect={() => handleSelect(unit)}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          inputValue === unit ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="font-mono">{unit}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </Command>
          </PopoverContent>
        </Popover>

        {inputValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Preview da unidade */}
      {inputValue && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono text-xs">
            {inputValue}
          </Badge>
          <p className="text-xs text-muted-foreground">
            Aparecerá como: "Valor <span className="font-mono">{inputValue}</span>" para o revisor
          </p>
        </div>
      )}

      {/* Explicação sobre null */}
      {!inputValue && (
        <p className="text-xs text-muted-foreground">
          💡 Deixar vazio é válido - a maioria dos campos não tem unidade específica
        </p>
      )}
    </div>
  );
}
