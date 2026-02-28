import { useMemo, useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isMultiOtherValue } from '@/lib/validations/selectOther';

interface MultiSelectWithOtherProps {
  options: string[];
  value: string[] | { selected: string[]; other_texts: string[] } | null;
  onChange: (val: string[] | { selected: string[]; other_texts: string[] } | null) => void;
  allowOther?: boolean;
  otherLabel?: string | null;
  otherPlaceholder?: string | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function MultiSelectWithOther(props: MultiSelectWithOtherProps) {
  const { options, value, onChange, allowOther = false, otherLabel = 'Outro (especificar)', otherPlaceholder, disabled, placeholder = 'Selecione...', className } = props;

  const [open, setOpen] = useState(false);
  const [internalSelected, setInternalSelected] = useState<string[]>([]);
  const [internalOthers, setInternalOthers] = useState<string[]>([]);

  useEffect(() => {
    if (!value) {
      setInternalSelected([]);
      setInternalOthers([]);
      return;
    }
    if (Array.isArray(value)) {
      setInternalSelected(value);
      setInternalOthers([]);
    } else if (isMultiOtherValue(value)) {
      setInternalSelected(value.selected || []);
      setInternalOthers(value.other_texts || []);
    } else {
      // Fallback para compatibilidade
      setInternalSelected([]);
      setInternalOthers([]);
    }
  }, [value]);

  const summary = useMemo(() => {
    const parts = [...internalSelected];
    if (allowOther && internalOthers.length > 0) {
      parts.push(...internalOthers.map((t) => `${otherLabel}: ${t}`));
    }
    return parts.length > 0 ? parts.join(', ') : '';
  }, [internalSelected, internalOthers, allowOther, otherLabel]);

  const toggleOption = (opt: string) => {
    const set = new Set(internalSelected);
    if (set.has(opt)) set.delete(opt); else set.add(opt);
    const next = Array.from(set);
    setInternalSelected(next);
    // Sempre usar formato objeto se allowOther está habilitado (mesmo sem "outros" ainda)
    onChange(allowOther ? { selected: next, other_texts: internalOthers } : next);
  };

  const addOther = () => {
    setInternalOthers([...internalOthers, '']);
  };

  const updateOther = (idx: number, text: string) => {
    const next = [...internalOthers];
    next[idx] = text;
    setInternalOthers(next);
    onChange({ selected: internalSelected, other_texts: next });
  };

  const removeOther = (idx: number) => {
    const next = internalOthers.filter((_, i) => i !== idx);
    setInternalOthers(next);
    onChange({ selected: internalSelected, other_texts: next });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('w-full justify-between', className)} disabled={disabled}>
          <span className="truncate text-left">{summary || placeholder}</span>
          <span className="text-muted-foreground">▾</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-3">
        <div className="space-y-2">
          <div className="max-h-56 overflow-auto pr-2 space-y-2">
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <Checkbox checked={internalSelected.includes(opt)} onCheckedChange={() => toggleOption(opt)} disabled={disabled} />
                <span>{opt}</span>
              </label>
            ))}
          </div>

          {allowOther && (
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{otherLabel || 'Outro (especificar)'}</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addOther} disabled={disabled}>Adicionar</Button>
              </div>
              <div className="space-y-2">
                {internalOthers.map((txt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input value={txt} placeholder={otherPlaceholder || 'Digite aqui'} onChange={(e) => updateOther(idx, e.target.value)} disabled={disabled} />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeOther(idx)} disabled={disabled}>×</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MultiSelectWithOther;


