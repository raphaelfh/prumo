/**
 * Popover de detalhes da sugestão (Reasoning + Evidence)
 * Componente compartilhado reutilizável
 */

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Sparkles } from 'lucide-react';
import { AISuggestionEvidence } from '../AISuggestionEvidence';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

interface AISuggestionDetailsPopoverProps {
  suggestion: AISuggestion;
  trigger: React.ReactNode;
}

export function AISuggestionDetailsPopover({
  suggestion,
  trigger,
}: AISuggestionDetailsPopoverProps) {
  const [open, setOpen] = useState(false);

  const hasReasoning = suggestion.reasoning && suggestion.reasoning.trim().length > 0;
  const hasEvidence = suggestion.evidence && suggestion.evidence.text && suggestion.evidence.text.trim().length > 0;

  if (!hasReasoning && !hasEvidence) {
    return <>{trigger}</>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent 
        className="w-[calc(100vw-2rem)] sm:w-96 p-0" 
        align="start"
        side="top"
      >
        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Sparkles className="h-4 w-4 text-purple-600 shrink-0" />
            <h4 className="font-semibold text-sm">Detalhes da Sugestão</h4>
          </div>

          {hasReasoning && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground">
                Justificativa
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                {suggestion.reasoning}
              </p>
            </div>
          )}

          {hasEvidence && (
            <div className="space-y-3">
              <AISuggestionEvidence
                evidence={{
                  text: suggestion.evidence!.text,
                  pageNumber: suggestion.evidence!.pageNumber,
                }}
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

