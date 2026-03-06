/**
 * NavigationTools - Page navigation tools
 *
 * Features:
 * - Previous/Next buttons
 * - Page input with validation
 * - Total page count display
 * - Keyboard shortcuts (PageUp/PageDown)
 */

import {useEffect, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {usePDFStore} from '@/stores/usePDFStore';
import {t} from '@/lib/copy';

export function NavigationTools() {
  const { currentPage, numPages, nextPage, prevPage, goToPage } = usePDFStore();
  const [pageInput, setPageInput] = useState(currentPage.toString());

    // Sync input with currentPage
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(pageInput, 10);
    
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= numPages) {
      goToPage(pageNum);
    } else {
        // Reset to current page if invalid
      setPageInput(currentPage.toString());
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
      // Allow numbers only
    if (value === '' || /^\d+$/.test(value)) {
      setPageInput(value);
    }
  };

    // Always show full navigation
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={prevPage}
        disabled={currentPage <= 1}
        title={t('pdf', 'pagePrevTitle')}
        className="h-8 w-8"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
        <Input
          type="text"
          value={pageInput}
          onChange={handlePageInputChange}
          onBlur={handlePageSubmit}
          className="w-12 h-8 text-center text-sm px-1"
          aria-label={t('pdf', 'pageNumberAria')}
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          / {numPages}
        </span>
      </form>

      <Button
        variant="ghost"
        size="icon"
        onClick={nextPage}
        disabled={currentPage >= numPages}
        title={t('pdf', 'pageNextTitle')}
        className="h-8 w-8"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

