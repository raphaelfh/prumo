/**
 * Dialog de Conflito de Template
 * 
 * Aparece quando usuário tenta importar um template mas já existe um ativo.
 * Oferece 3 opções:
 * - MERGE: Adicionar novos campos/seções sem perder dados
 * - REPLACE: Substituir completamente (PERDE DADOS!)
 * - CANCEL: Manter template atual
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
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  GitMerge, 
  Trash2, 
  X,
  Info,
  Database,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';

// =================== INTERFACES ===================

interface TemplateConflictDialogProps {
  open: boolean;
  onClose: () => void;
  existingTemplate: {
    id: string;
    name: string;
    framework: string;
    extractedValuesCount: number;
  };
  newTemplate: {
    name: string;
    framework: string;
    description?: string;
  };
  onAction: (action: 'merge' | 'replace' | 'cancel') => void;
  loading?: boolean;
}

type ConflictAction = 'merge' | 'replace' | 'cancel' | null;

// =================== COMPONENT ===================

export function TemplateConflictDialog(props: TemplateConflictDialogProps) {
  const { 
    open, 
    onClose, 
    existingTemplate, 
    newTemplate, 
    onAction,
    loading = false 
  } = props;

  const [selectedAction, setSelectedAction] = useState<ConflictAction>(null);
  const [showReplaceWarning, setShowReplaceWarning] = useState(false);

  const hasData = existingTemplate.extractedValuesCount > 0;

  const handleActionClick = (action: ConflictAction) => {
    if (action === 'replace' && hasData) {
      setShowReplaceWarning(true);
      setSelectedAction(action);
    } else {
      setSelectedAction(action);
      if (action) {
        onAction(action);
      }
    }
  };

  const handleConfirmReplace = () => {
    if (selectedAction === 'replace') {
      onAction('replace');
    }
  };

  const handleCancel = () => {
    setShowReplaceWarning(false);
    setSelectedAction(null);
    onClose();
  };

  // Se está mostrando warning de replace
  if (showReplaceWarning) {
    return (
      <Dialog open={open} onOpenChange={handleCancel}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              ATENÇÃO: Perda de Dados
            </DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita!
            </DialogDescription>
          </DialogHeader>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p className="font-semibold">
                O template atual contém {existingTemplate.extractedValuesCount} valores extraídos.
              </p>
              <p>
                Ao substituir o template, <strong>TODOS esses dados serão permanentemente perdidos</strong> e não poderão ser recuperados.
              </p>
            </AlertDescription>
          </Alert>

          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground">
              <strong>Alternativa recomendada:</strong> Use a opção <Badge variant="outline" className="mx-1">Mesclar</Badge> 
              para adicionar novos campos sem perder os dados já extraídos.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowReplaceWarning(false)}
              disabled={loading}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReplace}
              disabled={loading}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Sim, substituir e perder dados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Dialog principal de escolha
  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Template Existente Detectado
          </DialogTitle>
          <DialogDescription>
            Já existe um template ativo neste projeto. Como deseja proceder?
          </DialogDescription>
        </DialogHeader>

        {/* Status Atual */}
        <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Template Atual</p>
              <p className="text-sm text-muted-foreground">{existingTemplate.name}</p>
            </div>
            <Badge variant="secondary">{existingTemplate.framework}</Badge>
          </div>

          {hasData && (
            <div className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-blue-500" />
              <span className="text-muted-foreground">
                {existingTemplate.extractedValuesCount} valores extraídos
              </span>
            </div>
          )}
        </div>

        {/* Template Novo */}
        <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Template a Importar</p>
              <p className="text-sm text-muted-foreground">{newTemplate.name}</p>
            </div>
            <Badge variant="secondary">{newTemplate.framework}</Badge>
          </div>

          {newTemplate.description && (
            <p className="text-xs text-muted-foreground">
              {newTemplate.description}
            </p>
          )}
        </div>

        {/* Opções */}
        <div className="space-y-3">
          {/* Opção 1: Mesclar (RECOMENDADO) */}
          <button
            onClick={() => handleActionClick('merge')}
            disabled={loading}
            className={cn(
              "w-full text-left p-4 rounded-lg border-2 transition-all",
              "hover:border-primary hover:bg-accent",
              "focus:outline-none focus:ring-2 focus:ring-primary",
              selectedAction === 'merge' && "border-primary bg-accent"
            )}
          >
            <div className="flex items-start gap-3">
              <GitMerge className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">Mesclar</p>
                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                    Recomendado
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Adicionar novas seções e campos do template importado <strong>sem perder dados existentes</strong>. 
                  Os dados já extraídos serão preservados.
                </p>
              </div>
            </div>
          </button>

          {/* Opção 2: Substituir (PERIGO) */}
          <button
            onClick={() => handleActionClick('replace')}
            disabled={loading}
            className={cn(
              "w-full text-left p-4 rounded-lg border-2 transition-all",
              "hover:border-destructive hover:bg-destructive/5",
              "focus:outline-none focus:ring-2 focus:ring-destructive",
              selectedAction === 'replace' && "border-destructive bg-destructive/5"
            )}
          >
            <div className="flex items-start gap-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-destructive">Substituir</p>
                  {hasData && (
                    <Badge variant="destructive" className="text-xs">
                      Perda de Dados
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Substituir o template atual completamente.
                  {hasData && (
                    <strong className="text-destructive">
                      {' '}ATENÇÃO: Todos os {existingTemplate.extractedValuesCount} valores extraídos serão permanentemente perdidos!
                    </strong>
                  )}
                </p>
              </div>
            </div>
          </button>

          {/* Opção 3: Cancelar */}
          <button
            onClick={() => handleActionClick('cancel')}
            disabled={loading}
            className={cn(
              "w-full text-left p-4 rounded-lg border-2 transition-all",
              "hover:border-muted-foreground hover:bg-muted",
              "focus:outline-none focus:ring-2 focus:ring-muted-foreground",
              selectedAction === 'cancel' && "border-muted-foreground bg-muted"
            )}
          >
            <div className="flex items-start gap-3">
              <X className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="font-semibold">Cancelar</p>
                <p className="text-sm text-muted-foreground">
                  Manter o template atual sem alterações. Não importar o novo template.
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* Info adicional */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Dica:</strong> Na maioria dos casos, a opção <strong>Mesclar</strong> é a mais segura, 
            pois preserva seus dados enquanto adiciona novos campos do template importado.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={loading}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


