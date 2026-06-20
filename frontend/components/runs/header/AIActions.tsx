import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/copy';

interface AIActionsProps {
  pendingCount: number;
  canExtract: boolean;
  extracting?: boolean;
  onExtract: () => void;
  onOpenSuggestions?: () => void;
}

export function AIActions({ pendingCount, canExtract, extracting, onExtract, onOpenSuggestions }: AIActionsProps) {
  if (canExtract) {
    return (
      <Button size="sm" variant="secondary" onClick={onExtract} disabled={extracting} className="gap-1.5">
        <Sparkles className="h-4 w-4 text-ai" aria-hidden="true" />
        {extracting ? t('extraction', 'extractingWithAI') : t('runs', 'extractWithAI')}
      </Button>
    );
  }
  if (pendingCount <= 0) return null;
  return (
    <button type="button" onClick={() => onOpenSuggestions?.()} className="flex items-center gap-1.5 rounded-md border border-ai/40 bg-ai/10 px-2.5 py-0.5 text-[11px] text-ai focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />AI · {pendingCount}
    </button>
  );
}
