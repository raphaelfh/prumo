import * as React from 'react';
import {Input} from '@/components/ui/input';
import {Search} from 'lucide-react';
import {cn} from '@/lib/utils';

interface ListToolbarSearchProps {
    ref?: React.RefObject<HTMLInputElement | null>;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    /** Merged over the wrapper's default sizing (full width below `md`). */
    className?: string;
}

export const ListToolbarSearch = React.forwardRef<
    HTMLInputElement,
    ListToolbarSearchProps
>(function ListToolbarSearch({placeholder, value, onChange, className}, ref) {
    return (
        <div className={cn('w-full md:flex-1 md:min-w-[200px] group', className)}>
            <div className="relative">
                <Search
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground"/>
                <Input
                    ref={ref}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="pl-8 h-8 bg-muted/40 border-transparent focus:bg-background focus:ring-0 focus:border-border/60 focus:shadow-xs transition-all text-sm rounded-md"
                />
            </div>
        </div>
    );
});
