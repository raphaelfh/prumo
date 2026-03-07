/**
 * AI suggestion history popover - Assessment
 *
 * Shows suggestion history for an assessment item
 * Allows re-accept or re-reject past suggestions
 *
 * Adaptado de extraction/ai/AISuggestionHistoryPopover.tsx
 *
 * @component
 */

import {useCallback, useEffect, useState} from 'react';
import {Popover, PopoverContent, PopoverTrigger,} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Clock, Loader2, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {AIAssessmentSuggestionHistoryItem} from '@/types/assessment';
import {formatAssessmentLevel} from '@/lib/assessment-utils';
import {t} from '@/lib/copy';

const formatTimestamp = (date: Date | string, invalidLabel: string): string => {
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
      if (isNaN(dateObj.getTime())) return invalidLabel;
      return new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj);
  } catch {
      return invalidLabel;
  }
};

interface AISuggestionHistoryPopoverProps {
  itemId: string;
  currentSuggestionId?: string;
  getHistory: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>;
  onAccept?: () => void;
  onReject?: () => void;
  trigger: React.ReactNode;
}

export function AISuggestionHistoryPopover({
  itemId,
  currentSuggestionId,
  getHistory,
                                               onAccept: _onAccept,
  onReject,
  trigger,
}: AISuggestionHistoryPopoverProps) {
  const [history, setHistory] = useState<AIAssessmentSuggestionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const data = await getHistory(itemId);
      setHistory(data);
    } catch (err) {
        console.error('❌ [AISuggestionHistoryPopover] Error loading history:', err);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [itemId, getHistory]);

  useEffect(() => {
    if (open) {
      loadHistory();
    } else {
      setHistory([]);
    }
  }, [open, loadHistory]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[90vw] sm:max-w-md p-0 z-50" align="start" side="bottom">
        <div className="p-4 border-b">
            <h4 className="font-semibold text-sm">{t('assessment', 'aiHistoryTitle')}</h4>
          <p className="text-xs text-muted-foreground mt-1">
              {history.length} {t('assessment', 'aiHistoryCount')}
          </p>
        </div>

        <ScrollArea className="h-[400px] max-h-[70vh]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
                {t('assessment', 'aiHistoryEmpty')}
            </div>
          ) : (
            <div className="p-2 sm:p-3 space-y-2">
              {history.map((suggestion) => {
                const isCurrent = suggestion.id === currentSuggestionId;
                const confidencePercent = Math.round(suggestion.confidence * 100);

                return (
                  <div
                    key={suggestion.id}
                    className={cn(
                      "p-2 sm:p-3 rounded-lg border transition-colors",
                      isCurrent
                        ? "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800"
                        : "bg-background border-border hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {formatAssessmentLevel(suggestion.value.level)}
                        </p>
                        {suggestion.reasoning && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                            {suggestion.reasoning}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs shrink-0",
                          suggestion.status === 'accepted'
                            ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-800"
                            : suggestion.status === 'rejected'
                            ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/20 dark:border-red-800"
                            : "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-950/20 dark:border-purple-800"
                        )}
                      >
                        {suggestion.status === 'accepted'
                            ? t('assessment', 'aiHistoryAccepted')
                          : suggestion.status === 'rejected'
                                ? t('assessment', 'aiHistoryRejected')
                          : `${confidencePercent}%`}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                          <span>{formatTimestamp(suggestion.timestamp, t('assessment', 'aiHistoryInvalidDate'))}</span>
                      </div>

                      {isCurrent && suggestion.status === 'accepted' && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              onReject?.();
                              setOpen(false);
                            }}
                          >
                            <X className="h-3 w-3 mr-1" />
                              <span className="hidden sm:inline">{t('assessment', 'aiHistoryReject')}</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
