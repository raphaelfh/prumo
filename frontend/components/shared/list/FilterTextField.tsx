import * as React from 'react';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

interface FilterTextFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export function FilterTextField({
                                    id,
                                    label,
                                    value,
                                    onChange,
                                    placeholder,
                                }: FilterTextFieldProps) {
    return (
        <div className="space-y-2">
            <Label
                htmlFor={id}
                className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
            >
                {label}
            </Label>
            <Input
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-8 text-[13px]"
            />
        </div>
    );
}
