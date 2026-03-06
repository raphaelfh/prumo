/**
 * Campo de formulário com label e hint opcional.
 * Substitui o pattern repetido space-y-2 + Label + Input + hint.
 */

import * as React from 'react';
import {Label} from '@/components/ui/label';
import {cn} from '@/lib/utils';

export interface SettingsFieldProps {
    label: string;
    hint?: string;
    required?: boolean;
    htmlFor?: string;
    children: React.ReactNode;
    className?: string;
}

export function SettingsField({
                                  label,
                                  hint,
                                  required,
                                  htmlFor,
                                  children,
                                  className,
                              }: SettingsFieldProps) {
    return (
        <div className={cn('space-y-2', className)}>
            <Label htmlFor={htmlFor} className="text-[13px] font-medium">
                {label}
                {required && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            {children}
            {hint && (
                <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
                    {hint}
                </p>
            )}
        </div>
    );
}
