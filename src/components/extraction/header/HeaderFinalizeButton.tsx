/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Componente do botão Finalizar
 * Reutilizável com estados de loading e disabled
 */

import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle } from 'lucide-react';

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
  label = 'Finalizar',
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
          Finalizando...
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

