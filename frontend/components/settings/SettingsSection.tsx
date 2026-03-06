/**
 * Wrapper for settings section title and description.
 * Substitui o pattern repetido <div><h2>...</h2><p>...</p></div>.
 */

import * as React from 'react';
import {cn} from '@/lib/utils';

export interface SettingsSectionProps {
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}

export function SettingsSection({
                                    title,
                                    description,
                                    children,
                                    className,
                                }: SettingsSectionProps) {
    return (
        <div className={cn('space-y-6', className)}>
            <div>
                <h2 className="text-[13px] font-medium text-foreground mb-1">
                    {title}
                </h2>
                {description && (
                    <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
                        {description}
                    </p>
                )}
            </div>
            {children}
        </div>
    );
}
