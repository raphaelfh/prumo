import * as React from 'react';
import {Button} from '@/components/ui/button';
import {t} from '@/lib/copy';
import type {FilterFieldConfig, FilterValues} from './filter-types';
import {isFilterValueEmpty} from './filter-types';
import {FilterTextField} from './FilterTextField';
import {FilterCategoricalField} from './FilterCategoricalField';
import {FilterNumericRangeField} from './FilterNumericRangeField';

export interface FacetedValuesMap {
    [fieldId: string]: { value: string; count: number }[];
}

interface ListFilterPanelProps {
    fields: FilterFieldConfig[];
    values: FilterValues;
    onChange: (values: FilterValues) => void;
    facetedValues?: FacetedValuesMap;
}

export function ListFilterPanel({
                                    fields,
                                    values,
                                    onChange,
                                    facetedValues = {},
                                }: ListFilterPanelProps) {
    const updateField = (fieldId: string, value: FilterValues[string]) => {
        onChange({
            ...values,
            [fieldId]: value,
        });
    };

    const activeCount = fields.filter(
        (f) => !isFilterValueEmpty(values[f.id])
    ).length;

    return (
        <div className="space-y-3 p-3">
            {fields.map((field) => {
                const value = values[field.id];
                if (field.type === 'text') {
                    return (
                        <FilterTextField
                            key={field.id}
                            id={field.id}
                            label={field.label}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(v) => updateField(field.id, v)}
                            placeholder={field.placeholder}
                        />
                    );
                }
                if (field.type === 'categorical') {
                    const selected = Array.isArray(value) ? value : [];
                    const counts: Record<string, number> = {};
                    const facet = facetedValues[field.id];
                    if (facet) {
                        facet.forEach(({value: v, count}) => {
                            counts[v] = count;
                        });
                    }
                    return (
                        <FilterCategoricalField
                            key={field.id}
                            id={field.id}
                            label={field.label}
                            options={field.options ?? []}
                            value={selected}
                            onChange={(v) => updateField(field.id, v)}
                            counts={Object.keys(counts).length > 0 ? counts : undefined}
                        />
                    );
                }
                if (field.type === 'numericRange') {
                    const range =
                        value != null && typeof value === 'object' && !Array.isArray(value)
                            ? (value as { min?: number; max?: number })
                            : {};
                    return (
                        <FilterNumericRangeField
                            key={field.id}
                            id={field.id}
                            label={field.label}
                            value={range}
                            onChange={(v) => updateField(field.id, v)}
                            minBound={field.minBound}
                            maxBound={field.maxBound}
                            step={field.step}
                        />
                    );
                }
                return null;
            })}
            {activeCount > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-[12px] text-muted-foreground"
                    onClick={() => {
                        const next: FilterValues = {};
                        fields.forEach((f) => {
                            if (f.type === 'categorical') next[f.id] = [];
                            else if (f.type === 'numericRange') next[f.id] = {};
                            else next[f.id] = '';
                        });
                        onChange(next);
                    }}
                >
                    {t('common', 'listFilterClearAll')}
                </Button>
            )}
        </div>
    );
}
