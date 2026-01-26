/**
 * Componente para Exibir Evidence de Sugestão de IA - Assessment
 *
 * Mostra o trecho do texto citado pelo LLM como evidência para a avaliação,
 * incluindo número da página (se disponível).
 *
 * Adaptado de extraction/ai/AISuggestionEvidence.tsx
 *
 * @component
 */

import { FileText, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useState } from 'react';
import { cn } from '@/lib/utils';

// =================== INTERFACES ===================

interface AISuggestionEvidenceProps {
  evidence: {
    text: string;
    pageNumber?: number | null;
  };
  className?: string;
  showCopyButton?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionEvidence(props: AISuggestionEvidenceProps) {
  const { evidence, className, showCopyButton = true } = props;
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(evidence.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy evidence text:', err);
    }
  };

  return (
    <div className={cn("flex flex-col gap-4 p-4 bg-muted/50 rounded-lg border", className)}>
      {/* Header com ícone e página */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="font-medium">Evidência citada</span>
          {evidence.pageNumber !== null && evidence.pageNumber !== undefined && (
            <span className="px-2 py-1 bg-background rounded text-xs shrink-0">
              Página {evidence.pageNumber}
            </span>
          )}
        </div>

        {showCopyButton && (
          <Tooltip open={showTooltip && !copied} delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 shrink-0 hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopy();
                  setShowTooltip(false);
                }}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                aria-label={copied ? 'Copiado!' : 'Copiar trecho'}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" onPointerDownOutside={() => setShowTooltip(false)}>
              <p>Copiar trecho</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Trecho do texto */}
      <blockquote className="text-sm text-foreground/90 italic pl-3 sm:pl-5 border-l-2 border-primary/20 whitespace-pre-wrap break-words leading-relaxed">
        "{evidence.text}"
      </blockquote>
    </div>
  );
}
