/**
 * AI suggestion history popover
 *
 * Shows full history of suggestions grouped by run_id
 * Allows accepting/rejecting past suggestions
 * 
 * @component
 */

import {useCallback, useEffect, useState} from 'react';
import {Popover, PopoverContent, PopoverTrigger,} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {Check, Clock, Loader2, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import type {AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';

const formatTimestamp = (date: Date | string, invalidLabel: string = 'Invalid date'): string => {
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

// =================== INTERFACES ===================

interface AISuggestionHistoryPopoverProps {
  instanceId: string;
  fieldId: string;
  currentSuggestionId?: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  onAccept?: (suggestion: AISuggestionHistoryItem) => void;
  onReject?: (suggestion: AISuggestionHistoryItem) => void;
  trigger: React.ReactNode;
}

// =================== COMPONENT ===================

export function AISuggestionHistoryPopover(props: AISuggestionHistoryPopoverProps) {
  const {
    instanceId,
    fieldId,
    currentSuggestionId,
    getHistory,
    onAccept,
    onReject,
    trigger,
  } = props;

  const [history, setHistory] = useState<AISuggestionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!instanceId || !fieldId) {
        console.warn('[AISuggestionHistoryPopover] instanceId or fieldId not provided');
      return;
    }

    setLoading(true);
    try {
        console.warn('[AISuggestionHistoryPopover] Loading history...', {instanceId, fieldId});
      const data = await getHistory(instanceId, fieldId);
        console.warn('[AISuggestionHistoryPopover] History loaded:', {count: data.length, data});
      setHistory(data);
    } catch (err) {
        console.error('[AISuggestionHistoryPopover] Error loading history:', err);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [instanceId, fieldId, getHistory]);

  useEffect(() => {
    if (open) {
      loadHistory();
    } else {
        // Clear history on close so next open has fresh data
      setHistory([]);
    }
  }, [open, loadHistory]);

  // Agrupar por runId (tratar casos onde runId pode ser undefined/null)
  const groupedByRun = history.reduce((acc, suggestion) => {
    const runId = suggestion.runId || 'unknown';
    if (!acc[runId]) {
      acc[runId] = [];
    }
    acc[runId].push(suggestion);
    return acc;
  }, {} as Record<string, AISuggestionHistoryItem[]>);

    const invalidDateLabel = t('extraction', 'historyInvalidDate');
  const formatValue = (value: any): string => {
      if (value === null || value === undefined) return t('extraction', 'emptyValue');
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' && value.length > 50) {
      return `${value.substring(0, 50)}...`;
    }
    return String(value);
  };


  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[90vw] sm:max-w-md p-0 z-50" align="start" side="bottom">
        <div className="p-4 border-b">
            <h4 className="font-semibold text-sm">{t('extraction', 'historySuggestionsTitle')}</h4>
          <p className="text-xs text-muted-foreground mt-1">
              {history.length} {t('extraction', 'historySuggestionsCount')}
          </p>
        </div>

        <ScrollArea className="h-[400px] max-h-[70vh]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
                {t('extraction', 'historyNoSuggestions')}
            </div>
          ) : (
            <div className="p-2 sm:p-3">
              {Object.entries(groupedByRun).map(([runId, suggestions], runIndex) => (
                <div key={runId} className="mb-4">
                  {/* Header do Run */}
                  <div className="px-2 py-1.5 mb-2 bg-muted/50 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">
                        {t('extraction', 'historyExtractionRun')} #{runIndex + 1}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatTimestamp(suggestions[0].timestamp, invalidDateLabel)}
                      </span>
                    </div>
                  </div>

                    {/* Run suggestions */}
                  <div className="space-y-2">
                    {suggestions.map((suggestion) => {
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
                          {/* Valor e Status */}
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <p className="text-sm font-medium break-words">
                                {formatValue(suggestion.value)}
                              </p>
                              {suggestion.reasoning && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-3 break-words">
                                  {suggestion.reasoning}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-xs",
                                  suggestion.status === 'accepted'
                                    ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-800"
                                    : suggestion.status === 'rejected'
                                    ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/20 dark:border-red-800"
                                    : "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-950/20 dark:border-purple-800"
                                )}
                              >
                                {suggestion.status === 'accepted'
                                    ? t('extraction', 'suggestionAccepted')
                                  : suggestion.status === 'rejected'
                                        ? t('extraction', 'suggestionRejected')
                                  : `${confidencePercent}%`}
                              </Badge>
                            </div>
                          </div>

                            {/* Metadata and actions */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                              <Clock className="h-3 w-3" />
                                <span
                                    className="truncate">{formatTimestamp(suggestion.timestamp, invalidDateLabel)}</span>
                            </div>

                            {suggestion.status === 'pending' && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => {
                                    if (onAccept) onAccept(suggestion);
                                  }}
                                >
                                  <Check className="h-3 w-3 mr-1" />
                                  <span className="hidden sm:inline">Aceitar</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => {
                                    if (onReject) onReject(suggestion);
                                  }}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  <span className="hidden sm:inline">Rejeitar</span>
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {runIndex < Object.keys(groupedByRun).length - 1 && (
                    <Separator className="my-4" />
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

