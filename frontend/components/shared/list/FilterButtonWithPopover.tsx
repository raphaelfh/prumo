import * as React from 'react';
import {Button} from '@/components/ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {Filter} from 'lucide-react';

interface FilterButtonWithPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    activeCount: number;
    tooltipLabel: string;
    ariaLabel: string;
    children: React.ReactNode;
}

export function FilterButtonWithPopover({
                                            open,
                                            onOpenChange,
                                            activeCount,
                                            tooltipLabel,
                                            ariaLabel,
                                            children,
                                        }: FilterButtonWithPopoverProps) {
    return (
        <Popover open={open} onOpenChange={onOpenChange} modal={false}>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`h-8 w-8 p-0 rounded-md hover:bg-muted/50 transition-colors relative ${
                                    activeCount > 0 ? 'text-primary' : 'text-muted-foreground'
                                }`}
                                aria-label={ariaLabel}
                            >
                                <Filter className="h-4 w-4"/>
                                {activeCount > 0 && (
                                    <span
                                        className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary/15 px-0.5 text-[10px] font-semibold text-primary">
                    {activeCount}
                  </span>
                                )}
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <PopoverContent
                className="p-0 border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
                align="end"
                sideOffset={6}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                {children}
            </PopoverContent>
        </Popover>
    );
}
