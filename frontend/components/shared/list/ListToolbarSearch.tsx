import * as React from 'react';
import {Input} from '@/components/ui/input';
import {Search} from 'lucide-react';

interface ListToolbarSearchProps {
    ref?: React.RefObject<HTMLInputElement | null>;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
}

export const ListToolbarSearch = React.forwardRef<
    HTMLInputElement,
    ListToolbarSearchProps
>(function ListToolbarSearch({placeholder, value, onChange}, ref) {
    return (
        <div className="flex-1 min-w-[200px] group">
            <div className="relative">
                <Search
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground"/>
                <Input
                    ref={ref}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="pl-8 h-8 bg-muted/40 border-transparent focus:bg-background focus:ring-0 focus:border-border/60 focus:shadow-sm transition-all text-sm rounded-md"
                />
            </div>
        </div>
    );
});
