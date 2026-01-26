/**
 * Header Finalize Button - Assessment Module
 *
 * Sub-componente do header responsável por:
 * - Botão de finalização da avaliação
 * - Indicador de submitting
 * - Desabilitado quando incompleto ou salvando
 *
 * Baseado em ExtractionHeader/HeaderFinalizeButton (DRY + KISS)
 *
 * @component
 */

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CheckCircle, Loader2 } from 'lucide-react';

// =================== INTERFACES ===================

export interface HeaderFinalizeButtonProps {
  isComplete: boolean;
  isSaving?: boolean;
  submitting?: boolean;
  onFinalize: () => void;
}

// =================== COMPONENT ===================

export function HeaderFinalizeButton(props: HeaderFinalizeButtonProps) {
  const { isComplete, isSaving, submitting, onFinalize } = props;

  const isDisabled = !isComplete || isSaving || submitting;

  const tooltipMessage = !isComplete
    ? 'Complete todos os items obrigatórios'
    : isSaving
    ? 'Aguarde o salvamento automático'
    : submitting
    ? 'Finalizando...'
    : 'Finalizar e submeter avaliação';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="default"
          size="sm"
          onClick={onFinalize}
          disabled={isDisabled}
          className="gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Finalizando...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              Concluir Avaliação
            </>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipMessage}</p>
      </TooltipContent>
    </Tooltip>
  );
}
