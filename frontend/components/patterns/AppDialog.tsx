/**
 * AppDialog - Dialog com tamanho e footer padronizados
 * 
 * Uso:
 * <AppDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="Confirmar Exclusão"
 *   description="Esta ação não pode ser desfeita"
 *   size="sm"
 *   onConfirm={handleDelete}
 *   confirmLabel="Excluir"
 *   confirmVariant="destructive"
 * >
 *   <p>Conteúdo do modal...</p>
 * </AppDialog>
 */

import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button, type ButtonProps} from '@/components/ui/button';
import {cn} from '@/lib/utils';

interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonProps['variant'];
  isLoading?: boolean;
  showFooter?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  onConfirm,
  onCancel,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmVariant = 'default',
  isLoading = false,
  showFooter = true,
}: AppDialogProps) {
  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(sizeClasses[size])}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        
        <div className="py-4">{children}</div>
        
        {showFooter && (
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={handleCancel}
              disabled={isLoading}
            >
              {cancelLabel}
            </Button>
            {onConfirm && (
              <Button 
                variant={confirmVariant} 
                onClick={onConfirm}
                disabled={isLoading}
              >
                {confirmLabel}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

