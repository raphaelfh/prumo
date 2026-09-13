import * as React from 'react';
import {Filter} from 'lucide-react';

import {IconButton} from '@/components/patterns/IconButton';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {cn} from '@/lib/utils';

interface FilterButtonWithPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    activeCount: number;
    /** Accessible name and tooltip. The F chip is added here: every caller mounts useListKeyboardShortcuts, which binds F. */
    label: string;
    children: React.ReactNode;
}

export function FilterButtonWithPopover({open, onOpenChange, activeCount, label, children}: FilterButtonWithPopoverProps) {
    return (
        <Popover open={open} onOpenChange={onOpenChange} modal={false}>
            <PopoverTrigger asChild>
                <IconButton
                    label={label}
                    shortcut={['F']}
                    side="bottom"
                    className={cn('relative', activeCount > 0 && 'text-primary')}
                    icon={
                        <>
                            <Filter />
                            {activeCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary/15 px-0.5 text-[10px] font-semibold text-primary">
                                    {activeCount}
                                </span>
                            )}
                        </>
                    }
                />
            </PopoverTrigger>
            <PopoverContent
                className="p-0 border-border/50 shadow-elev-popover max-h-[min(85vh,28rem)] overflow-y-auto overflow-x-hidden"
                align="end"
                sideOffset={6}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                {children}
            </PopoverContent>
        </Popover>
    );
}
