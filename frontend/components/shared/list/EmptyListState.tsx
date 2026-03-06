import * as React from 'react';
import {Button} from '@/components/ui/button';
import type {LucideIcon} from 'lucide-react';

interface EmptyListStateProps {
    icon: LucideIcon;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
}

export function EmptyListState({
                                   icon: Icon,
                                   title,
                                   description,
                                   actionLabel,
                                   onAction,
                                   className,
                               }: EmptyListStateProps) {
    return (
        <div
            className={
                className ??
                'flex flex-col items-center justify-center py-24 px-4 bg-muted/10 rounded-lg border border-dashed border-border/40'
            }
        >
            <Icon className="h-10 w-10 text-muted-foreground/30 mb-4" strokeWidth={1.2}/>
            <h3 className="text-base font-medium text-foreground mb-1.5 text-center">
                {title}
            </h3>
            {description && (
                <p className="text-[13px] text-muted-foreground text-center max-w-xs mx-auto">
                    {description}
                </p>
            )}
            {actionLabel && onAction && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onAction}
                    className="mt-6 text-[12px] font-semibold underline underline-offset-4 hover:bg-transparent"
                >
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}
