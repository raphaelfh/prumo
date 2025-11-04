/**
 * Componente para Exibir Evidence de Sugestão de IA
 * 
 * Mostra o trecho do texto citado pelo LLM como evidência para a extração,
 * incluindo número da página (se disponível).
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
    <div className={cn("flex flex-col gap-2 p-3 bg-muted/50 rounded-lg border", className)}>
      {/* Header com ícone e página */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          <span className="font-medium">Evidência citada</span>
          {evidence.pageNumber !== null && evidence.pageNumber !== undefined && (
            <span className="px-1.5 py-0.5 bg-background rounded text-xs">
              Página {evidence.pageNumber}
            </span>
          )}
        </div>
        
        {showCopyButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{copied ? 'Copiado!' : 'Copiar trecho'}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Trecho do texto */}
      <blockquote className="text-sm text-foreground/90 italic pl-4 border-l-2 border-primary/20 whitespace-pre-wrap break-words">
        "{evidence.text}"
      </blockquote>
    </div>
  );
}

