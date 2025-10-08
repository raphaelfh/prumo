/**
 * Dialog de confirmação para excluir campo
 * 
 * Features:
 * - Mostra impacto da exclusão (valores extraídos, artigos afetados)
 * - Bloqueia exclusão se houver dados
 * - Avisos visuais claros com cores apropriadas
 * - Loading state durante operação
 * 
 * @component
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertCircle, Loader2, AlertTriangle } from 'lucide-react';
import { ExtractionField, FieldValidationResult } from '@/types/extraction';
import { Badge } from '@/components/ui/badge';

interface DeleteFieldConfirmProps {
  field: ExtractionField | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (fieldId: string) => Promise<boolean>;
  validation: FieldValidationResult | null;
  loading: boolean;
}

export function DeleteFieldConfirm({
  field,
  open,
  onOpenChange,
  onConfirm,
  validation,
  loading,
}: DeleteFieldConfirmProps) {
  if (!field) return null;

  const canDelete = validation?.canDelete ?? false;
  const extractedCount = validation?.extractedValuesCount ?? 0;
  const affectedArticlesCount = validation?.affectedArticles?.length ?? 0;

  const handleConfirm = async () => {
    const success = await onConfirm(field.id);
    if (success) {
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {canDelete ? (
              <>
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Confirmar Exclusão
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-destructive" />
                Não é Possível Excluir
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
              {/* Informações do campo */}
              <div>
                <p className="text-foreground">
                  Você está tentando excluir o campo:
                </p>
                <div className="mt-2 rounded-lg bg-muted p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{field.label}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {field.description || 'Sem descrição'}
                      </p>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {field.field_type}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Aviso baseado no status */}
              {canDelete ? (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-orange-900">Atenção:</p>
                      <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-orange-800">
                        <li>Esta ação não pode ser desfeita</li>
                        <li>O campo será removido permanentemente da seção</li>
                        <li>Novos artigos não terão mais este campo disponível</li>
                        <li>Artigos já iniciados não serão afetados (mantêm estrutura)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-destructive">Impossível excluir:</p>
                      <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-destructive/90">
                        <li>
                          Este campo possui <strong>{extractedCount} valores extraídos</strong>
                        </li>
                        <li>
                          Afeta <strong>{affectedArticlesCount} artigo(s)</strong> em extração
                        </li>
                        <li>
                          Excluir causaria perda de dados e inconsistências
                        </li>
                      </ul>
                      <div className="mt-3 p-2 bg-muted rounded text-xs">
                        <p className="font-medium">💡 Alternativas:</p>
                        <ul className="mt-1 list-disc list-inside">
                          <li>Marque como "não obrigatório" em vez de excluir</li>
                          <li>Delete os valores extraídos primeiro (com cuidado)</li>
                          <li>Entre em contato com o administrador</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>
            {canDelete ? 'Cancelar' : 'Entendi'}
          </AlertDialogCancel>
          {canDelete && (
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={loading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir Campo
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

