/**
 * Section card with title and description in compact Plane/Linear style.
 * Aplica bordas e sombra suaves conforme design system.
 */

import * as React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {cn} from '@/lib/utils';

export interface SettingsCardProps {
    title: string;
    description?: string;
    icon?: LucideIcon;
    children: React.ReactNode;
    className?: string;
    /** Destructive border for danger zone */
    destructive?: boolean;
}

export function SettingsCard({
                                 title,
                                 description,
                                 icon: Icon,
                                 children,
                                 className,
                                 destructive,
                             }: SettingsCardProps) {
    return (
        <Card
            className={cn(
                'border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-md',
                destructive && 'border-destructive/20',
                className
            )}
        >
            <CardHeader className="p-4 pb-2">
                <CardTitle
                    className={cn(
                        'text-[13px] font-medium leading-none flex items-center gap-2',
                        destructive && 'text-destructive'
                    )}
                >
                    {Icon && <Icon className="h-4 w-4" strokeWidth={1.5}/>}
                    {title}
                </CardTitle>
                {description && (
                    <CardDescription className="text-[12px] text-muted-foreground/70 mt-1.5">
                        {description}
                    </CardDescription>
                )}
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-4">
                {children}
            </CardContent>
        </Card>
    );
}
