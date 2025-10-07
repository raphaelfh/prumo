import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface GlobalSearchProps {
  placeholder?: string;
  className?: string;
  onSearch?: (query: string) => void;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  placeholder = "Buscar...",
  className,
  onSearch
}) => {
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(query);
  };

  const handleClear = () => {
    setQuery('');
    onSearch?.('');
  };

  return (
    <form onSubmit={handleSearch} className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="pl-9 pr-9"
      />
      {query && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClear}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </form>
  );
};

export const MobileSearchTrigger: React.FC = () => {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="md:hidden"
      aria-label="Abrir busca"
    >
      <Search className="h-4 w-4" />
    </Button>
  );
};
