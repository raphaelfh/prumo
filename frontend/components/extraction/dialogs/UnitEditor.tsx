/**
 * Measure unit editor
 * 
 * Features:
 * - Input with common suggestions
 * - Dropdown with categories (time, weight, dimension, etc.)
 * - Permite valores customizados
 * - Pode ser null/vazio (opcional)
 * - Size validation
 * 
 * @component
 */

import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Popover, PopoverContent, PopoverTrigger,} from '@/components/ui/popover';
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem,} from '@/components/ui/command';
import {Check, ChevronDown, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface UnitEditorProps {
  value: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

// Common units organized by category
const COMMON_UNITS = {
    'Time': [
        'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'
  ],
    'Weight/Mass': [
        'mg', 'g', 'kg', 'pounds', 'ounces'
  ],
    'Dimension': [
        'mm', 'cm', 'm', 'km', 'inches', 'feet'
  ],
  'Volume': [
      'ml', 'l', 'gallons'
  ],
    'Pressure': [
    'mmHg', 'kPa', 'atm'
  ],
    'Temperature': [
    '°C', '°F', 'K'
  ],
    'Percentage/Score': [
        '%', 'points', 'score', 'scale'
  ],
    'Frequency': [
        'Hz', 'bpm', 'per minute', 'per hour', 'per day'
  ],
    'Other': [
        'units', 'doses', 'cycles', 'episodes'
  ],
};

// Flatten all units for search
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
      onChange(newValue || null); // Convert empty string to null
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
            placeholder={t('extraction', 'unitPlaceholder')}
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
                {t('extraction', 'unitSuggestionsButton')}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="end">
            <Command>
                <CommandInput placeholder={t('extraction', 'unitSearchPlaceholder')}/>
                <CommandEmpty>{t('extraction', 'unitNoneFound')}</CommandEmpty>
              
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
              Will appear as: "Value <span className="font-mono">{inputValue}</span>" for the reviewer
          </p>
        </div>
      )}

        {/* Explanation about null */}
      {!inputValue && (
        <p className="text-xs text-muted-foreground">
            💡 Leaving empty is valid - most fields have no specific unit
        </p>
      )}
    </div>
  );
}
