/**
 * Hook para gerenciar processo de importação do Zotero
 */

import {useCallback, useState} from 'react';
import {zoteroService} from '@/services/zoteroImportService';
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
   * Lista collections disponíveis no Zotero
   */
  const listCollections = useCallback(async () => {
    setLoadingCollections(true);
    try {
      const collections = await zoteroService.listCollections();
      setCollections(collections);
      return collections;
    } catch (error: any) {
      console.error('Erro ao listar collections:', error);
        toast.error(error.message || t('extraction', 'errors_zoteroFetch'));
      return [];
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  /**
   * Inicia importação de uma collection
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

    try {
      const result = await zoteroService.importFromCollection(
        projectId,
        collectionKey,
        options,
        (progressUpdate) => {
          setProgress(progressUpdate);
          onProgressUpdate?.(progressUpdate);
        }
      );

      if (result.success) {
        const pdfMsg = result.stats.pdfsDownloaded
            ? t('extraction', 'zoteroImportPdfsDownloaded').replace('{{n}}', String(result.stats.pdfsDownloaded))
          : '';
        toast.success(
            t('extraction', 'zoteroImportCompleteSuccess')
                .replace('{{imported}}', String(result.stats.imported))
                .replace('{{updated}}', String(result.stats.updated)) + pdfMsg
        );
      } else {
          toast.error(t('extraction', 'zoteroImportCompletedWithErrors'));
      }

      return result;
    } catch (error: any) {
        console.error('Import error:', error);
        toast.error(error.message || t('extraction', 'errors_zoteroImport'));
      
      const errorProgress: ImportProgress = {
        phase: 'error',
        current: 0,
        total: 0,
          message: error.message || t('extraction', 'errors_zoteroImport'),
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
    } finally {
      setImporting(false);
      setCurrentJobId(null);
    }
  }, []);

  /**
   * Cancela importação em andamento
   */
  const cancelImport = useCallback(() => {
    zoteroService.cancelImport();
    setImporting(false);
    setProgress(null);
    setCurrentJobId(null);
      toast.info(t('extraction', 'zoteroImportCancelled'));
  }, []);

  /**
   * Reseta estado de progresso
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

