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
    const label = extracting ? t('runs', 'extractingWithAI') : t('runs', 'extractWithAI');
    return (
      // Label collapses to the icon below 48rem; aria-label keeps the
      // accessible name since the Sparkles icon is aria-hidden.
      <Button size="sm" variant="ghost" onClick={onExtract} disabled={extracting} aria-label={label} className="shrink-0 gap-1.5 whitespace-nowrap">
        <Sparkles className="h-4 w-4 text-ai" strokeWidth={1.5} aria-hidden="true" />
        <span className="hidden @[48rem]/headerbar:inline">{label}</span>
      </Button>
    );
  }
  if (pendingCount <= 0) return null;
  return (
    <button type="button" onClick={() => onOpenSuggestions?.()} aria-label={t('runs', 'aiPendingSuggestions').replace('{{n}}', String(pendingCount))} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-ai/10 px-1.5 py-0.5 text-[11px] text-ai focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" /><span className="hidden @[48rem]/headerbar:inline" aria-hidden="true">AI · </span><span aria-hidden="true">{pendingCount}</span>
    </button>
  );
}
