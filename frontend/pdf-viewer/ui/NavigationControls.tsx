import {useState, useEffect} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useViewerStore} from '../core/context';

export function NavigationControls({className}: {className?: string}) {
  const currentPage = useViewerStore((s) => s.currentPage);
  const numPages = useViewerStore((s) => s.numPages);
  const goToPage = useViewerStore((s) => s.actions.goToPage);
  const [local, setLocal] = useState(String(currentPage));

  useEffect(() => {
    setLocal(String(currentPage));
  }, [currentPage]);

  const submit = () => {
    const n = parseInt(local, 10);
    if (!Number.isNaN(n)) goToPage(n);
    else setLocal(String(currentPage));
  };

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <Button
        variant="ghost"
        size="icon"
        disabled={currentPage <= 1}
        onClick={() => goToPage(currentPage - 1)}
        aria-label="Previous page"
        className="h-8 w-8"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-12 h-8 text-center text-sm px-1"
        aria-label="Current page"
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        / {numPages || '—'}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled={currentPage >= numPages}
        onClick={() => goToPage(currentPage + 1)}
        aria-label="Next page"
        className="h-8 w-8"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
