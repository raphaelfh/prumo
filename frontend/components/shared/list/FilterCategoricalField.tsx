import * as React from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';

interface FilterCategoricalFieldProps {
    id: string;
    label: string;
    options: { value: string; label: string }[];
    value: string[];
    onChange: (value: string[]) => void;
    counts?: Record<string, number>;
}

export function FilterCategoricalField({
                                           id,
                                           label,
                                           options,
                                           value,
                                           onChange,
                                           counts,
                                       }: FilterCategoricalFieldProps) {
    const toggle = (optValue: string) => {
        const set = new Set(value);
        if (set.has(optValue)) set.delete(optValue);
        else set.add(optValue);
        onChange(Array.from(set));
    };

    return (
        <div className="space-y-2">
            <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {label}
            </Label>
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1" role="group" aria-labelledby={`${id}-label`}>
        <span id={`${id}-label`} className="sr-only">
          {label}
        </span>
                {options.map((opt) => (
                    <label
                        key={opt.value}
                        className="flex items-center gap-2 cursor-pointer text-[13px]"
                    >
                        <Checkbox
                            checked={value.includes(opt.value)}
                            onCheckedChange={() => toggle(opt.value)}
                            className="h-3.5 w-3.5 rounded-sm"
                        />
                        <span>
              {opt.label}
                            {counts && counts[opt.value] != null && (
                                <span className="text-muted-foreground ml-1">
                  ({counts[opt.value]})
                </span>
                            )}
            </span>
                    </label>
                ))}
            </div>
        </div>
    );
}
