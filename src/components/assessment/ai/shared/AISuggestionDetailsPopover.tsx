/**
 * Popover de detalhes da sugestão (Reasoning + Evidence) - Assessment
 * Componente compartilhado reutilizável
 *
 * Adaptado de extraction/ai/shared/AISuggestionDetailsPopover.tsx
 */

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles } from 'lucide-react';
import { AISuggestionEvidence } from '../AISuggestionEvidence';
import type { AIAssessmentSuggestion } from '@/types/assessment';

// =================== INTERFACES ===================

interface AISuggestionDetailsPopoverProps {
  suggestion: AIAssessmentSuggestion;
  trigger: React.ReactNode;
}

// =================== COMPONENT ===================

export function AISuggestionDetailsPopover({
  suggestion,
  trigger,
}: AISuggestionDetailsPopoverProps) {
  const [open, setOpen] = useState(false);

  const hasReasoning = suggestion.reasoning && suggestion.reasoning.trim().length > 0;
  const hasEvidence = suggestion.suggested_value.evidence_passages?.length > 0;

  if (!hasReasoning && !hasEvidence) {
    return <>{trigger}</>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] sm:w-[420px] p-0"
        align="start"
        side="top"
      >
        {/* Header fixo */}
        <div className="p-4 pb-3 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600 shrink-0" />
            <h4 className="font-semibold text-sm">Detalhes da Sugestão</h4>
          </div>
        </div>

        {/* Conteúdo rolável */}
        <ScrollArea className="max-h-[70vh] sm:max-h-[60vh]">
          <div className="p-4 pt-3 space-y-5">
            {hasReasoning && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Justificativa
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {suggestion.reasoning}
                </p>
              </div>
            )}

            {hasEvidence && suggestion.suggested_value.evidence_passages.map((evidence, idx) => (
              <div key={idx} className="space-y-2">
                <AISuggestionEvidence
                  evidence={{
                    text: evidence.text,
                    pageNumber: evidence.page_number ?? null,
                  }}
                />
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
