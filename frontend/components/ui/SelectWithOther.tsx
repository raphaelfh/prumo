import {useEffect, useMemo, useState} from 'react';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {isOtherObject, OTHER_OPTION_VALUE} from '@/lib/validations/selectOther';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';

interface SelectWithOtherProps {
  options: string[];
  value: string | { selected: 'other'; other_text: string } | null;
  onChange: (val: string | { selected: 'other'; other_text: string } | null) => void;
  allowOther?: boolean;
  otherLabel?: string | null;
  otherPlaceholder?: string | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function SelectWithOther(props: SelectWithOtherProps) {
    const {
        options,
        value,
        onChange,
        allowOther = false,
        otherLabel = t('common', 'otherSpecify'),
        otherPlaceholder,
        disabled,
        placeholder,
        className
    } = props;

  const [internalOtherText, setInternalOtherText] = useState('');

    // Detect if "Other" is selected (accepts empty other_text to show input immediately)
  const isOtherSelected = useMemo(() => {
    if (!allowOther || !value) return false;
    // Aceitar objeto com selected='other' mesmo se other_text estiver vazio
    return isOtherObject(value);
  }, [value, allowOther]);

  // Sincronizar internalOtherText com value (garantir que sempre reflete o valor atual)
  useEffect(() => {
    if (isOtherSelected && isOtherObject(value)) {
      const currentText = (value as any).other_text || '';
        // Only update if different to avoid loops
      if (currentText !== internalOtherText) {
        setInternalOtherText(currentText);
      }
    } else if (!isOtherSelected) {
        // Clear only if really not selected
      if (internalOtherText !== '') {
        setInternalOtherText('');
      }
    }
  }, [value, isOtherSelected]); // Remover internalOtherText das deps para evitar loop

  const handleSelect = (val: string) => {
    if (allowOther && val === OTHER_OPTION_VALUE) {
      // Criar objeto "outro" imediatamente, mesmo com texto vazio
      // Isso garante que o input aparece imediatamente
      const newValue = { selected: 'other' as const, other_text: internalOtherText || '' };
      onChange(newValue);
        // Ensure internalOtherText is in sync
      if (!internalOtherText) {
        setInternalOtherText('');
      }
    } else {
      onChange(val);
    }
  };

  const effectiveValue = isOtherSelected ? OTHER_OPTION_VALUE : (typeof value === 'string' ? value : (value as any) || '');

  return (
    <div className={cn('space-y-2', className)}>
      <Select value={(effectiveValue as any) || ''} onValueChange={handleSelect} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
            {allowOther &&
                <SelectItem value={OTHER_OPTION_VALUE}>{otherLabel || t('common', 'otherSpecify')}</SelectItem>}
        </SelectContent>
      </Select>

      {allowOther && isOtherSelected && (
        <Input
          value={internalOtherText}
          onChange={(e) => {
            const text = e.target.value;
            setInternalOtherText(text);
            onChange({ selected: 'other', other_text: text });
          }}
          placeholder={otherPlaceholder || t('common', 'typeHere')}
          disabled={disabled}
        />
      )}
    </div>
  );
}

export default SelectWithOther;


