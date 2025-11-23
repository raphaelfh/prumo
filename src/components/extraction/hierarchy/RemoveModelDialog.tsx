/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Remove Model Dialog
 * 
 * Dialog de confirmação para remover um modelo de predição.
 * Avisa o usuário se o modelo tem dados extraídos.
 * 
 * Features:
 * - Aviso destacado se modelo tem dados
 * - Contagem de campos preenchidos
 * - Loading state durante remoção
 * - Mensagens claras sobre consequências
 * 
 * @component
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Trash2, Loader2, Info } from 'lucide-react';
import { extractionLogger } from '@/lib/extraction/observability';

// =================== INTERFACES ===================

interface RemoveModelDialogProps {
  open: boolean;
  modelName: string;
  hasExtractedData: boolean;
  extractedFieldsCount?: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

// =================== COMPONENT ===================

export function RemoveModelDialog({
  open,
  modelName,
  hasExtractedData,
  extractedFieldsCount = 0,
  onConfirm,
  onCancel
}: RemoveModelDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handler de confirmação
  const handleConfirm = async () => {
    setLoading(true);
    setError(null);

    try {
      extractionLogger.info('removeModelDialog', 'Iniciando remoção de modelo', {
        modelName,
        hasExtractedData,
        extractedFieldsCount
      });

      await onConfirm();
      
      extractionLogger.info('removeModelDialog', 'Modelo removido com sucesso', {
        modelName
      });
      
      // Dialog será fechado pelo parent component
    } catch (err: any) {
      extractionLogger.error('removeModelDialog', 'Falha ao remover modelo', err, {
        modelName,
        hasExtractedData
      });
      
      setError(err.message || 'Erro ao remover modelo');
    } finally {
      // ✅ SEMPRE resetar loading, independente de sucesso/erro
      // Isso previne o modal ficar travado no estado "Removendo..."
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !loading && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Remover Modelo
          </DialogTitle>
          <DialogDescription>
            Você está prestes a remover o modelo "{modelName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Aviso se tem dados extraídos */}
          {hasExtractedData ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">
                    Atenção: Este modelo contém dados extraídos!
                  </p>
                  <p>
                    <strong>{extractedFieldsCount}</strong> {extractedFieldsCount === 1 ? 'campo está preenchido' : 'campos estão preenchidos'} neste modelo.
                  </p>
                  <p className="text-sm">
                    Todos os dados extraídos serão permanentemente removidos e não poderão ser recuperados.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Este modelo não possui dados extraídos. A remoção não afetará outros modelos ou seções study-level.
              </AlertDescription>
            </Alert>
          )}

          {/* Detalhes da operação */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <p className="text-sm font-medium text-slate-900 mb-2">
              O que será removido:
            </p>
            <ul className="space-y-1 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                <span>Modelo "{modelName}"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                <span>Todas as sub-seções deste modelo (Candidate Predictors, Final Predictors, etc.)</span>
              </li>
              {hasExtractedData && (
                <li className="flex items-start gap-2">
                  <span className="text-destructive">•</span>
                  <span className="font-medium">Todos os valores extraídos ({extractedFieldsCount} campos)</span>
                </li>
              )}
            </ul>
          </div>

          {/* Erro */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Removendo...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                {hasExtractedData ? 'Sim, Remover Mesmo Assim' : 'Remover Modelo'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

