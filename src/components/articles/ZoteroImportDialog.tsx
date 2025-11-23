/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Diálogo multi-step para importação de artigos do Zotero
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  ChevronRight,
  ChevronLeft,
  Download,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  FolderOpen,
  Minimize2,
} from 'lucide-react';
import { useZoteroImport } from '@/hooks/useZoteroImport';
import { useBackgroundJobs } from '@/stores/useBackgroundJobs';
import { useProject } from '@/contexts/ProjectContext';
import { createZoteroImportJob } from '@/types/background-jobs';
import type { ZoteroCollection, ImportOptions } from '@/types/zotero';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ZoteroImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onImportComplete?: () => void;
}

type Step = 'select-collection' | 'configure-options' | 'importing';

export function ZoteroImportDialog({
  open,
  onOpenChange,
  projectId,
  onImportComplete,
}: ZoteroImportDialogProps) {
  const {
    collections,
    loadingCollections,
    importing,
    progress,
    listCollections,
    startImport,
    cancelImport,
    resetProgress,
    currentJobId,
  } = useZoteroImport();

  const { addJob, updateJob } = useBackgroundJobs();
  const { project } = useProject();

  const [currentStep, setCurrentStep] = useState<Step>('select-collection');
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    downloadPdfs: true, // Habilitado agora que está implementado
    onlyPdfs: true, // Por padrão, baixar apenas PDFs
    updateExisting: true,
    importTags: true,
    conflictResolution: 'update',
  });

  // Carregar collections quando abrir o diálogo ou projectId mudar
  useEffect(() => {
    if (open) {
      console.log('[ZoteroImportDialog] Dialog aberto com projectId:', projectId);
      listCollections();
      setCurrentStep('select-collection');
      setSelectedCollection(null);
      resetProgress();
    }
  }, [open, projectId, listCollections, resetProgress]);

  // Log quando projectId muda
  useEffect(() => {
    console.log('[ZoteroImportDialog] ProjectId atualizado:', projectId);
  }, [projectId]);

  const handleNext = () => {
    if (currentStep === 'select-collection' && selectedCollection) {
      setCurrentStep('configure-options');
    }
  };

  const handleBack = () => {
    if (currentStep === 'configure-options') {
      setCurrentStep('select-collection');
    }
  };

  const handleStartImport = async () => {
    if (!selectedCollection) return;

    const selectedCollectionData = collections.find(c => c.key === selectedCollection);

    // Criar background job
    const job = createZoteroImportJob(
      projectId,
      selectedCollection,
      importOptions,
      {
        projectName: project?.name,
        collectionName: selectedCollectionData?.data.name,
      }
    );

    // Adicionar job ao store
    addJob(job);

    setCurrentStep('importing');

    // Iniciar importação com callback para atualizar job
    const result = await startImport(
      projectId, 
      selectedCollection, 
      importOptions,
      job.id,
      (updatedProgress) => {
        // Atualizar job com progresso
        updateJob(job.id, {
          status: 'running',
          progress: updatedProgress,
          stats: updatedProgress.stats,
          startedAt: job.startedAt || Date.now(),
        });
      }
    );

    // Atualizar job com resultado final
    if (result?.success) {
      updateJob(job.id, {
        status: 'completed',
        completedAt: Date.now(),
        stats: result.stats,
      });
      onImportComplete?.();
    } else {
      updateJob(job.id, {
        status: 'failed',
        completedAt: Date.now(),
        error: result?.errors?.[0]?.error || 'Erro na importação',
      });
    }
  };

  const handleClose = () => {
    if (importing) {
      // Se está importando, mostrar confirmação
      setShowCloseConfirm(true);
    } else {
      onOpenChange(false);
    }
  };

  const handleConfirmMinimize = () => {
    // Minimizar: apenas fechar dialog, importação continua
    setShowCloseConfirm(false);
    onOpenChange(false);
    toast.info('Importação continuando em background. Você será notificado quando concluir.', {
      duration: 4000,
    });
  };

  const handleConfirmCancel = () => {
    // Cancelar: interromper importação
    cancelImport();
    setShowCloseConfirm(false);
    onOpenChange(false);
    
    // Atualizar job como cancelado
    if (currentJobId) {
      updateJob(currentJobId, {
        status: 'cancelled',
        completedAt: Date.now(),
      });
    }
  };

  const canProceed = selectedCollection !== null;
  const progressPercentage = progress
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Importar do Zotero</DialogTitle>
          <DialogDescription>
            {currentStep === 'select-collection' && 'Selecione uma collection para importar'}
            {currentStep === 'configure-options' && 'Configure as opções de importação'}
            {currentStep === 'importing' && 'Importando artigos...'}
          </DialogDescription>
        </DialogHeader>

        {/* Área de conteúdo com scroll */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
          {/* Step 1: Selecionar Collection */}
          {currentStep === 'select-collection' && (
            <div className="space-y-4">
              {loadingCollections ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : collections.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Nenhuma collection encontrada na sua biblioteca Zotero.
                  </AlertDescription>
                </Alert>
              ) : (
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-2">
                    {collections.map((collection) => (
                      <button
                        key={collection.key}
                        onClick={() => setSelectedCollection(collection.key)}
                        className={cn(
                          'w-full text-left p-4 rounded-lg border transition-colors',
                          'hover:bg-accent hover:border-accent-foreground/20',
                          selectedCollection === collection.key
                            ? 'bg-accent border-accent-foreground/40'
                            : 'bg-background'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedCollection === collection.key}
                            onCheckedChange={() => setSelectedCollection(collection.key)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                              <p className="font-medium truncate">
                                {collection.data.name}
                              </p>
                            </div>
                            {collection.meta?.numItems !== undefined && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {collection.meta.numItems}{' '}
                                {collection.meta.numItems === 1 ? 'item' : 'items'}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Step 2: Configurar Opções */}
          {currentStep === 'configure-options' && (
            <div className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Configure como os artigos devem ser importados.
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div className="flex items-start space-x-3 p-4 rounded-lg border">
                  <Checkbox
                    id="download-pdfs"
                    checked={importOptions.downloadPdfs}
                    onCheckedChange={(checked) =>
                      setImportOptions({ ...importOptions, downloadPdfs: checked as boolean })
                    }
                  />
                  <div className="space-y-1 flex-1">
                    <Label htmlFor="download-pdfs" className="cursor-pointer">
                      Baixar PDFs automaticamente
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Download de PDFs e attachments do Zotero. Primeiro PDF será o arquivo principal (MAIN).
                    </p>
                  </div>
                </div>

                {/* Sub-opção: Apenas PDFs */}
                {importOptions.downloadPdfs && (
                  <div className="flex items-start space-x-3 p-4 rounded-lg border ml-8">
                    <Checkbox
                      id="only-pdfs"
                      checked={importOptions.onlyPdfs}
                      onCheckedChange={(checked) =>
                        setImportOptions({ ...importOptions, onlyPdfs: checked as boolean })
                      }
                    />
                    <div className="space-y-1 flex-1">
                      <Label htmlFor="only-pdfs" className="cursor-pointer">
                        Baixar apenas PDFs
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Se desabilitado, também baixa snapshots HTML e outros attachments
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start space-x-3 p-4 rounded-lg border">
                  <Checkbox
                    id="update-existing"
                    checked={importOptions.updateExisting}
                    onCheckedChange={(checked) =>
                      setImportOptions({ ...importOptions, updateExisting: checked as boolean })
                    }
                  />
                  <div className="space-y-1 flex-1">
                    <Label htmlFor="update-existing" className="cursor-pointer">
                      Atualizar artigos existentes
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Se um artigo com mesmo DOI já existir, atualizar seus metadados
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-4 rounded-lg border">
                  <Checkbox
                    id="import-tags"
                    checked={importOptions.importTags}
                    onCheckedChange={(checked) =>
                      setImportOptions({ ...importOptions, importTags: checked as boolean })
                    }
                  />
                  <div className="space-y-1 flex-1">
                    <Label htmlFor="import-tags" className="cursor-pointer">
                      Importar tags como keywords
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Tags do Zotero serão importadas como palavras-chave do artigo
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Progresso da Importação */}
          {currentStep === 'importing' && progress && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm gap-2">
                  <span className="truncate flex-1">{progress.message}</span>
                  <span className="text-muted-foreground flex-shrink-0">
                    {progress.current}/{progress.total}
                  </span>
                </div>
                <Progress value={progressPercentage} className="h-2" />
              </div>

              {/* Grid de estatísticas - 2 cols em mobile, 3 em desktop */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                    <span>Importados</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.imported}</p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <Download className="h-3 w-3 flex-shrink-0" />
                    <span>Atualizados</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.updated}</p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                    <span>Pulados</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.skipped}</p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <XCircle className="h-3 w-3 flex-shrink-0" />
                    <span>Erros</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.errors}</p>
                </div>

                {/* PDFs Baixados - aparece no grid junto com as outras stats */}
                {progress.stats.pdfsDownloaded !== undefined && progress.stats.pdfsDownloaded > 0 && (
                  <div className="p-3 rounded-lg border bg-primary/5">
                    <div className="flex items-center gap-1 text-xs text-primary mb-1">
                      <Download className="h-3 w-3 flex-shrink-0" />
                      <span>PDFs</span>
                    </div>
                    <p className="text-xl font-bold text-primary">{progress.stats.pdfsDownloaded}</p>
                  </div>
                )}
              </div>

              {/* Mostrar arquivo sendo processado - com line-clamp para limitar a 2 linhas */}
              {progress.currentFile && (
                <div className="px-3 py-2 rounded-lg bg-muted/30 border border-dashed">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Processando:
                  </p>
                  <p 
                    className="text-sm font-medium line-clamp-2 leading-tight" 
                    title={progress.currentFile}
                  >
                    {progress.currentFile}
                  </p>
                </div>
              )}

              {progress.phase === 'complete' && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Importação concluída com sucesso!
                  </AlertDescription>
                </Alert>
              )}

              {progress.phase === 'error' && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    {progress.message}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          </div>
        </ScrollArea>

        {/* Footer com botões */}
        <div className="flex justify-between pt-4 border-t flex-shrink-0">
          <div>
            {currentStep === 'configure-options' && (
              <Button variant="outline" onClick={handleBack} disabled={importing}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Voltar
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              {importing ? (
                <>
                  <Minimize2 className="mr-2 h-4 w-4" />
                  Minimizar
                </>
              ) : (
                'Fechar'
              )}
            </Button>

            {currentStep === 'select-collection' && (
              <Button onClick={handleNext} disabled={!canProceed}>
                Próximo
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            )}

            {currentStep === 'configure-options' && (
              <Button onClick={handleStartImport} disabled={importing}>
                {importing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Iniciar Importação
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Confirmação ao fechar durante importação */}
    <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Importação em andamento</AlertDialogTitle>
          <AlertDialogDescription>
            A importação ainda está em execução. Você pode minimizar o diálogo e a importação 
            continuará em background, ou cancelar para interromper o processo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleConfirmCancel}>
            <XCircle className="mr-2 h-4 w-4" />
            Cancelar Importação
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmMinimize}>
            <Minimize2 className="mr-2 h-4 w-4" />
            Continuar em Background
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

