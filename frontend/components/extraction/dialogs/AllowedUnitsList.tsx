/**
 * Component to manage list of alternative units
 *
 * Features:
 * - Add unit via input + button
 * - Common unit suggestions (integrated with UnitEditor)
 * - Remove unit from list
 * - Reorder units (first is default)
 * - Real-time duplicate validation
 * - Visual list preview
 * - Visual indicator for default unit (first in list)
 *
 * @component
 */

import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {ChevronDown, GripVertical, Plus, Star, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {Popover, PopoverContent, PopoverTrigger,} from '@/components/ui/popover';
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem,} from '@/components/ui/command';

interface AllowedUnitsListProps {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

// Common units by category (aligned with UnitEditor)
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

      // Validations
    if (!trimmed) {
        setError(t('extraction', 'enterUnit'));
      return;
    }

    if (values.includes(trimmed)) {
        setError(t('extraction', 'unitAlreadyAdded'));
      return;
    }

    if (values.length >= 20) {
        setError(t('extraction', 'max20Units'));
      return;
    }

      // Add unit
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
            placeholder={t('extraction', 'placeholderUnits')}
            disabled={disabled}
            className={cn(error && 'border-destructive', 'font-mono')}
          />
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>

          {/* Suggestions button */}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="w-[100px]"
            >
                {t('extraction', 'suggestionsButton')}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[250px] p-0" align="end">
            <Command>
                <CommandInput placeholder={t('extraction', 'searchUnit')}/>
                <CommandEmpty>{t('extraction', 'noUnitFound')}</CommandEmpty>
              
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

        {/* Unit list */}
      {values.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">
                Available units ({values.length})
            </p>
            <p className="text-xs text-muted-foreground">
              <Star className="h-3 w-3 inline mr-1" />
                First is default
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
                      Default
                  </Badge>
                )}

                  {/* Reorder buttons */}
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleMoveUp(index)}
                    disabled={disabled || index === 0}
                    title={t('extraction', 'unitMoveUp')}
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
                    title={t('extraction', 'unitMoveDown')}
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
                    title={t('extraction', 'unitRemove')}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

            {/* Preview of how it will appear */}
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-2">
                Preview in extraction:
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
              {t('extraction', 'noUnitsConfigured')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
              {t('extraction', 'unitsEmptyHint')}
          </p>
        </div>
      )}
    </div>
  );
}

