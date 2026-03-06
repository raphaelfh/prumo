/**
 * Multi-step dialog for importing articles from Zotero
 */

import {useEffect, useState} from 'react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,} from '@/components/ui/dialog';
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
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {Progress} from '@/components/ui/progress';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Download,
    FolderOpen,
    Info,
    Loader2,
    Minimize2,
    XCircle,
} from 'lucide-react';
import {useZoteroImport} from '@/hooks/useZoteroImport';
import {useBackgroundJobs} from '@/stores/useBackgroundJobs';
import {useProject} from '@/contexts/ProjectContext';
import {createZoteroImportJob} from '@/types/background-jobs';
import type {ImportOptions} from '@/types/zotero';
import {cn} from '@/lib/utils';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

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
      downloadPdfs: true, // Enabled now that it is implemented
      onlyPdfs: true, // By default, download PDFs only
    updateExisting: true,
    importTags: true,
    conflictResolution: 'update',
  });

    // Load collections when dialog opens or projectId changes
  useEffect(() => {
    if (open) {
        console.log('[ZoteroImportDialog] Dialog opened with projectId:', projectId);
      listCollections();
      setCurrentStep('select-collection');
      setSelectedCollection(null);
      resetProgress();
    }
  }, [open, projectId, listCollections, resetProgress]);

    // Log when projectId changes
  useEffect(() => {
      console.log('[ZoteroImportDialog] ProjectId updated:', projectId);
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

      // Create background job
    const job = createZoteroImportJob(
      projectId,
      selectedCollection,
      importOptions,
      {
        projectName: project?.name,
        collectionName: selectedCollectionData?.data.name,
      }
    );

      // Add job to store
    addJob(job);

    setCurrentStep('importing');

      // Start import with callback to update job
    const result = await startImport(
      projectId, 
      selectedCollection, 
      importOptions,
      job.id,
      (updatedProgress) => {
          // Update job with progress
        updateJob(job.id, {
          status: 'running',
          progress: updatedProgress,
          stats: updatedProgress.stats,
          startedAt: job.startedAt || Date.now(),
        });
      }
    );

      // Update job with final result
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
          error: result?.errors?.[0]?.error || t('articles', 'zoteroImportError'),
      });
    }
  };

  const handleClose = () => {
    if (importing) {
        // If importing, show confirmation
      setShowCloseConfirm(true);
    } else {
      onOpenChange(false);
    }
  };

  const handleConfirmMinimize = () => {
      // Minimize: just close dialog, import continues
    setShowCloseConfirm(false);
    onOpenChange(false);
      toast.info(t('articles', 'zoteroImportContinuing'), {
      duration: 4000,
    });
  };

  const handleConfirmCancel = () => {
      // Cancel: stop import
    cancelImport();
    setShowCloseConfirm(false);
    onOpenChange(false);

      // Update job as cancelled
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
            <DialogTitle>{t('articles', 'zoteroTitle')}</DialogTitle>
          <DialogDescription>
              {currentStep === 'select-collection' && t('articles', 'zoteroSelectCollection')}
              {currentStep === 'configure-options' && t('articles', 'zoteroConfigureOptions')}
              {currentStep === 'importing' && t('articles', 'zoteroImportingArticles')}
          </DialogDescription>
        </DialogHeader>

            {/* Scrollable content area */}
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
                      {t('articles', 'zoteroNoCollectionsFound')}
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

              {/* Step 2: Configure options */}
          {currentStep === 'configure-options' && (
            <div className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                    {t('articles', 'zoteroStep2Desc')}
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
                        {t('articles', 'zoteroDownloadPdfs')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                        {t('articles', 'zoteroDownloadPdfsDesc')}
                    </p>
                  </div>
                </div>

                  {/* Sub-option: PDFs only */}
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
                          {t('articles', 'zoteroOnlyPdfs')}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                          {t('articles', 'zoteroOnlyPdfsDesc')}
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
                        {t('articles', 'zoteroUpdateExisting')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                        {t('articles', 'zoteroUpdateExistingDesc')}
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
                        {t('articles', 'zoteroImportTagsAsKeywords')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                        {t('articles', 'zoteroTagsAsKeywordsDesc')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

              {/* Step 3: Import progress */}
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

                {/* Stats grid - 2 cols on mobile, 3 on desktop */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                      <span>{t('articles', 'zoteroImported')}</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.imported}</p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <Download className="h-3 w-3 flex-shrink-0" />
                      <span>{t('articles', 'zoteroUpdated')}</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.updated}</p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      <span>{t('articles', 'zoteroSkipped')}</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.skipped}</p>
                </div>

                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <XCircle className="h-3 w-3 flex-shrink-0" />
                      <span>{t('articles', 'zoteroErrors')}</span>
                  </div>
                  <p className="text-xl font-bold">{progress.stats.errors}</p>
                </div>

                  {/* PDFs downloaded - shown in grid with other stats */}
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

                {/* Show file being processed - line-clamp to 2 lines */}
              {progress.currentFile && (
                <div className="px-3 py-2 rounded-lg bg-muted/30 border border-dashed">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                      Processing:
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
                      Import completed successfully!
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

            {/* Footer with buttons */}
        <div className="flex justify-between pt-4 border-t flex-shrink-0">
          <div>
            {currentStep === 'configure-options' && (
              <Button variant="outline" onClick={handleBack} disabled={importing}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                  {t('articles', 'zoteroBack')}
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              {importing ? (
                <>
                  <Minimize2 className="mr-2 h-4 w-4" />
                    {t('articles', 'zoteroMinimize')}
                </>
              ) : (
                  t('articles', 'zoteroClose')
              )}
            </Button>

            {currentStep === 'select-collection' && (
              <Button onClick={handleNext} disabled={!canProceed}>
                  {t('articles', 'zoteroNext')}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            )}

            {currentStep === 'configure-options' && (
              <Button onClick={handleStartImport} disabled={importing}>
                {importing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('articles', 'zoteroImporting')}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                      {t('articles', 'zoteroStartImport')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

        {/* Confirm when closing during import */}
    <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
            <AlertDialogTitle>{t('articles', 'zoteroCloseConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
              {t('articles', 'zoteroCloseConfirmDesc')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleConfirmCancel}>
            <XCircle className="mr-2 h-4 w-4" />
              {t('articles', 'zoteroCancelImport')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmMinimize}>
            <Minimize2 className="mr-2 h-4 w-4" />
              {t('articles', 'zoteroContinueInBackground')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

