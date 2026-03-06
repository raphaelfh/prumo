/**
 * Finalize button component. Reusable with loading and disabled states.
 */

import {Button} from '@/components/ui/button';
import {CheckCircle, Loader2} from 'lucide-react';
import {t} from '@/lib/copy';

interface HeaderFinalizeButtonProps {
  isComplete: boolean;
  onSubmit: () => void;
  submitting?: boolean;
  /** Variante do botão */
  variant?: 'default' | 'outline' | 'ghost';
  /** Tamanho do botão */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Texto customizado (opcional) */
  label?: string;
}

export function HeaderFinalizeButton({
  isComplete,
  onSubmit,
  submitting = false,
  variant = 'default',
  size = 'sm',
                                         label = t('extraction', 'headerFinalize'),
}: HeaderFinalizeButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onSubmit}
      disabled={!isComplete || submitting}
      className={`
        flex-shrink-0 font-medium 
        shadow-sm hover:shadow-md hover:scale-[1.02]
        transition-all duration-150 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
      `}
    >
      {submitting ? (
        <>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {t('extraction', 'headerFinalizing')}
        </>
      ) : (
        <>
          <CheckCircle className="mr-1.5 h-3.5 w-3.5 transition-transform duration-150" />
          {label}
        </>
      )}
    </Button>
  );
}

