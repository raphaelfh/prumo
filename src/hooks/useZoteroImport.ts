/**
 * Hook para gerenciar processo de importação do Zotero
 */

import { useState, useCallback } from 'react';
import { zoteroService } from '@/services/zoteroImportService';
import type { 
  ZoteroCollection, 
  ImportOptions, 
  ImportProgress, 
  ImportResult 
} from '@/types/zotero';
import { toast } from 'sonner';

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
      toast.error(error.message || 'Erro ao buscar collections do Zotero');
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
      message: 'Iniciando importação...',
      stats: {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
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
          ? `, ${result.stats.pdfsDownloaded} PDFs baixados` 
          : '';
        toast.success(
          `Importação concluída! ${result.stats.imported} importados, ${result.stats.updated} atualizados${pdfMsg}`
        );
      } else {
        toast.error('Importação concluída com erros');
      }

      return result;
    } catch (error: any) {
      console.error('Erro na importação:', error);
      toast.error(error.message || 'Erro ao importar artigos');
      
      const errorProgress: ImportProgress = {
        phase: 'error',
        current: 0,
        total: 0,
        message: error.message || 'Erro na importação',
        stats: {
          imported: 0,
          updated: 0,
          skipped: 0,
          errors: 1,
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
    toast.info('Importação cancelada');
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

