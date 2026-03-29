import * as React from 'react';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {t} from '@/lib/copy';

export interface NumericRangeValue {
    min?: number;
    max?: number;
}

interface FilterNumericRangeFieldProps {
    id: string;
    label: string;
    value: NumericRangeValue;
    onChange: (value: NumericRangeValue) => void;
    /** If set, use two Select dropdowns with options from minBound to maxBound (e.g. years) */
    minBound?: number;
    maxBound?: number;
    /** If no minBound/maxBound, use two number inputs with this step */
    step?: number;
}

const NONE = '_none';

export function FilterNumericRangeField({
                                            id: _id,
                                            label,
                                            value,
                                            onChange,
                                            minBound = 1990,
                                            maxBound = new Date().getFullYear(),
                                            step = 1,
                                        }: FilterNumericRangeFieldProps) {
    const useSelects = minBound != null && maxBound != null;
    const options = useSelects
        ? Array.from({length: maxBound - minBound + 1}, (_, i) => maxBound - i)
        : [];

    const fromVal = value.min;
    const toVal = value.max;

    const updateMin = (v: number | undefined) => {
        onChange({
            min: v,
            max: value.max,
        });
    };
    const updateMax = (v: number | undefined) => {
        onChange({
            min: value.min,
            max: v,
        });
    };

    if (useSelects) {
        return (
            <div className="space-y-2">
                <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {label}
                </Label>
                <div className="flex gap-2 items-center flex-wrap">
                    <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">
              {t('common', 'listFilterFrom')}
            </span>
                        <Select
                            value={fromVal != null ? String(fromVal) : NONE}
                            onValueChange={(v) => updateMin(v === NONE ? undefined : parseInt(v, 10))}
                        >
                            <SelectTrigger className="h-8 text-[13px] w-[100px]">
                                <SelectValue placeholder={t('common', 'listFilterAny')}/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>{t('common', 'listFilterAny')}</SelectItem>
                                {options.map((y) => (
                                    <SelectItem key={y} value={String(y)}>
                                        {y}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">
              {t('common', 'listFilterTo')}
            </span>
                        <Select
                            value={toVal != null ? String(toVal) : NONE}
                            onValueChange={(v) => updateMax(v === NONE ? undefined : parseInt(v, 10))}
                        >
                            <SelectTrigger className="h-8 text-[13px] w-[100px]">
                                <SelectValue placeholder={t('common', 'listFilterAny')}/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>{t('common', 'listFilterAny')}</SelectItem>
                                {options.map((y) => (
                                    <SelectItem key={y} value={String(y)}>
                                        {y}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {label}
            </Label>
            <div className="flex gap-2 items-center flex-wrap">
                <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">
            {t('common', 'listFilterFrom')}
          </span>
                    <Input
                        type="number"
                        value={fromVal ?? ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            updateMin(v === '' ? undefined : Number(v));
                        }}
                        placeholder={t('common', 'listFilterAny')}
                        className="h-8 text-[13px] w-24"
                        min={minBound}
                        max={maxBound}
                        step={step}
                    />
                </div>
                <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">
            {t('common', 'listFilterTo')}
          </span>
                    <Input
                        type="number"
                        value={toVal ?? ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            updateMax(v === '' ? undefined : Number(v));
                        }}
                        placeholder={t('common', 'listFilterAny')}
                        className="h-8 text-[13px] w-24"
                        min={minBound}
                        max={maxBound}
                        step={step}
                    />
                </div>
            </div>
        </div>
    );
}
