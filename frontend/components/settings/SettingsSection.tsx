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
    /**
     * `'comfortable'` (default) is the original card spacing (`space-y-6`)
     * every existing caller relies on -- pixel-identical unless a caller
     * opts in. `'compact'` is for dense, Zotero-style row lists (a few px
     * apart), where `space-y-6` between 4px-tall rows would defeat the
     * point of a dense record.
     */
    density?: 'comfortable' | 'compact';
}

const DENSITY_SPACING: Record<NonNullable<SettingsSectionProps['density']>, string> = {
    comfortable: 'space-y-6',
    compact: 'space-y-1',
};

export function SettingsSection({
                                    title,
                                    description,
                                    children,
                                    className,
                                    density = 'comfortable',
                                }: SettingsSectionProps) {
    return (
        <div className={cn(DENSITY_SPACING[density], className)}>
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
