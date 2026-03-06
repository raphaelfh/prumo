import {Loader2} from 'lucide-react';
import {t} from '@/lib/copy';

export function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('common', 'loadingPdf')}</p>
      </div>
    </div>
  );
}
