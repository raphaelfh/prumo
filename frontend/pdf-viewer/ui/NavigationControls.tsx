import {useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {IconButton} from '@/components/patterns/IconButton';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import {useViewerStore} from '../core/context';

export function NavigationControls({className}: {className?: string}) {
  const currentPage = useViewerStore((s) => s.currentPage);
  const numPages = useViewerStore((s) => s.numPages);
  const goToPage = useViewerStore((s) => s.actions.goToPage);
  const [local, setLocal] = useState(String(currentPage));

  // Mirror the store page into the input when it changes externally
  // (adjust-during-render instead of an effect).
  const [prevPage, setPrevPage] = useState(currentPage);
  if (currentPage !== prevPage) {
    setPrevPage(currentPage);
    setLocal(String(currentPage));
  }

  const submit = () => {
    const n = parseInt(local, 10);
    if (!Number.isNaN(n)) goToPage(n);
    else setLocal(String(currentPage));
  };

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <IconButton
        label={t('pdf', 'viewerPrevPage')}
        side="bottom"
        disabled={currentPage <= 1}
        onClick={() => goToPage(currentPage - 1)}
        data-viewer-step=""
        icon={<ChevronLeft strokeWidth={1.5} />}
      />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-7 w-10 px-1 text-center text-[13px] tabular-nums"
        aria-label={t('pdf', 'viewerCurrentPage')}
      />
      <span className="whitespace-nowrap px-1 text-[13px] tabular-nums text-muted-foreground">
        / {numPages || '—'}
      </span>
      <IconButton
        label={t('pdf', 'viewerNextPage')}
        side="bottom"
        disabled={currentPage >= numPages}
        onClick={() => goToPage(currentPage + 1)}
        data-viewer-step=""
        icon={<ChevronRight strokeWidth={1.5} />}
      />
    </div>
  );
}
