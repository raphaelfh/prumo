/**
 * Hook to manage the Zotero import process
 */

import {useCallback, useState} from 'react';
import {zoteroService, listZoteroCollections, importZoteroCollection} from '@/services/zoteroImportService';
import type {ImportOptions, ImportProgress, ImportResult, ZoteroCollection} from '@/types/zotero';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

export function useZoteroImport() {
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  /**
   * Lists available collections in Zotero
   * IO + try/catch/finally relocated to zoteroImportService.listZoteroCollections
   */
  const listCollections = useCallback(async () => {
    setLoadingCollections(true);
    const result = await listZoteroCollections();
    setLoadingCollections(false);
    if (result.ok) {
      setCollections(result.data);
      return result.data;
    }
    console.error('Error listing collections:', result.error);
    toast.error(result.error.message || t('extraction', 'errors_zoteroFetch'));
    return [];
  }, []);

  /**
   * Starts import of a collection
   * IO + try/catch/finally relocated to zoteroImportService.importZoteroCollection
   */
  const startImport = useCallback(async (
    projectId: string,
    collectionKey: string,
    options: ImportOptions,
    jobId?: string,
    onProgressUpdate?: (progress: ImportProgress) => void
  ): Promise<ImportResult | null> => {
    setImporting(true);
    if (jobId) {
      setCurrentJobId(jobId);
    }

    const initialProgress: ImportProgress = {
      phase: 'fetching',
      current: 0,
      total: 0,
      message: t('extraction', 'zoteroImportStarting'),
      stats: {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        removedAtSource: 0,
        reactivated: 0,
        pdfsDownloaded: 0,
      },
    };

    setProgress(initialProgress);
    onProgressUpdate?.(initialProgress);

    const result = await importZoteroCollection(
      projectId,
      collectionKey,
      options,
      (progressUpdate) => {
        setProgress(progressUpdate);
        onProgressUpdate?.(progressUpdate);
      },
    );

    setImporting(false);
    setCurrentJobId(null);

    if (!result.ok) {
      console.error('Import error:', result.error);
      toast.error(result.error.message || t('extraction', 'errors_zoteroImport'));

      const errorProgress: ImportProgress = {
        phase: 'error',
        current: 0,
        total: 0,
        message: result.error.message || t('extraction', 'errors_zoteroImport'),
        stats: {
          imported: 0,
          updated: 0,
          skipped: 0,
          errors: 1,
          removedAtSource: 0,
          reactivated: 0,
        },
      };
      setProgress(errorProgress);
      onProgressUpdate?.(errorProgress);
      return null;
    }

    const importResult = result.data;
    if (importResult.success) {
      const pdfMsg = importResult.stats.pdfsDownloaded
        ? t('extraction', 'zoteroImportPdfsDownloaded').replace('{{n}}', String(importResult.stats.pdfsDownloaded))
        : '';
      toast.success(
        t('extraction', 'zoteroImportCompleteSuccess')
          .replace('{{imported}}', String(importResult.stats.imported))
          .replace('{{updated}}', String(importResult.stats.updated)) + pdfMsg
      );
    } else {
      toast.error(t('extraction', 'zoteroImportCompletedWithErrors'));
    }

    return importResult;
  }, []);

  /**
   * Cancels import in progress
   */
  const cancelImport = useCallback(() => {
    zoteroService.cancelImport();
    setImporting(false);
    setProgress(null);
    setCurrentJobId(null);
    toast.info(t('extraction', 'zoteroImportCancelled'));
  }, []);

  /**
   * Resets progress state
   */
  const resetProgress = useCallback(() => {
    setProgress(null);
  }, []);

  return {
    collections,
    loadingCollections,
    importing,
    progress,
    currentJobId,
    listCollections,
    startImport,
    cancelImport,
    resetProgress,
  };
}
