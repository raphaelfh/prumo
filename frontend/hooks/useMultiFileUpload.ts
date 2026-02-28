/**
 * Hook para gerenciar upload de múltiplos arquivos
 * 
 * Funcionalidades:
 * - Fila de uploads com processamento paralelo
 * - Controle de concorrência
 * - Tracking de progresso individual
 * - Retry automático em caso de falha
 * - Cancelamento de uploads
 * - Estatísticas em tempo real
 */

import {useCallback, useRef, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {detectFileFormat, generateStorageKey, validateFile} from '@/lib/file-validation';
import {FILE_ERROR_MESSAGES} from '@/lib/file-constants';
import type {ArticleFile} from '@/types/article-files';

export interface UploadQueueItem {
  id: string;
  file: File;
  fileRole: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  result?: ArticleFile;
  uploadedSize?: number;
  speed?: number;
  startTime?: number;
  retryCount?: number;
}

export interface UseMultiFileUploadOptions {
  /**
   * Número máximo de uploads simultâneos
   */
  maxConcurrent?: number;
  
  /**
   * Número máximo de tentativas em caso de falha
   */
  maxRetries?: number;
  
  /**
   * Callback quando todos os uploads forem concluídos
   */
  onComplete?: (results: { successful: ArticleFile[]; failed: UploadQueueItem[] }) => void;
  
  /**
   * Callback para cada arquivo completado
   */
  onFileComplete?: (result: ArticleFile) => void;
  
  /**
   * Callback para progresso geral
   */
  onProgress?: (progress: number) => void;
}

export function useMultiFileUpload(
  projectId: string,
  articleId: string,
  options: UseMultiFileUploadOptions = {}
) {
  const {
    maxConcurrent = 3,
    maxRetries = 2,
    onComplete,
    onFileComplete,
    onProgress
  } = options;

  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const activeUploadsRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  /**
   * Adiciona arquivos à fila
   */
  const addFiles = useCallback((files: File[], fileRole: string) => {
    const newItems: UploadQueueItem[] = files.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      fileRole,
      status: 'pending',
      progress: 0,
      retryCount: 0
    }));

    setQueue(prev => [...prev, ...newItems]);
    return newItems;
  }, []);

  /**
   * Faz upload de um arquivo individual
   */
  const uploadSingleFile = useCallback(async (item: UploadQueueItem): Promise<ArticleFile> => {
    // Validar arquivo
    const validation = validateFile(item.file);
    if (!validation.valid) {
      throw new Error(validation.error || 'Arquivo inválido');
    }

    // Detectar formato
    const detectedFormat = validation.detectedFormat || detectFileFormat(item.file);

    // Gerar storage key
    const storageKey = generateStorageKey(projectId, articleId, item.file.name);

    // Criar AbortController para cancelamento
    const abortController = new AbortController();
    abortControllersRef.current.set(item.id, abortController);

    try {
      const startTime = Date.now();
      let uploadedBytes = 0;

      // Upload para o storage com progress tracking
      const { error: uploadError } = await supabase.storage
        .from('articles')
        .upload(storageKey, item.file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw new Error(FILE_ERROR_MESSAGES.STORAGE_ERROR + ': ' + uploadError.message);
      }

      // Simular progresso (o Supabase não fornece eventos de progresso nativamente)
      // Em produção, você pode usar XMLHttpRequest ou fetch com streams para progresso real
      const updateProgress = (progress: number) => {
        const elapsed = (Date.now() - startTime) / 1000;
        uploadedBytes = (item.file.size * progress) / 100;
        const speed = uploadedBytes / elapsed;

        setQueue(prev => prev.map(q =>
          q.id === item.id
            ? { ...q, progress, uploadedSize: uploadedBytes, speed, startTime }
            : q
        ));
      };

      // Simular progresso para feedback visual
      for (let i = 10; i <= 90; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        updateProgress(i);
      }

      // Inserir registro no banco
      const { data: articleFile, error: insertError } = await supabase
        .from('article_files')
        .insert({
          project_id: projectId,
          article_id: articleId,
          file_type: detectedFormat,
          file_role: item.fileRole,
          storage_key: storageKey,
          original_filename: item.file.name,
          bytes: item.file.size,
          md5: null
        })
        .select()
        .single();

      if (insertError) {
        // Rollback: remover arquivo do storage
        await supabase.storage.from('articles').remove([storageKey]);
        throw new Error(FILE_ERROR_MESSAGES.DATABASE_ERROR + ': ' + insertError.message);
      }

      updateProgress(100);
      return articleFile;

    } finally {
      abortControllersRef.current.delete(item.id);
    }
  }, [projectId, articleId]);

  /**
   * Processa a fila de uploads
   */
  const processQueue = useCallback(async () => {
    if (isUploading) return;
    
    setIsUploading(true);
    const results: ArticleFile[] = [];
    const failed: UploadQueueItem[] = [];

    const processNext = async (): Promise<void> => {
      // Encontrar próximo item pendente
      const nextItem = queue.find(
        item => item.status === 'pending' && !activeUploadsRef.current.has(item.id)
      );

      if (!nextItem) return;

      // Verificar limite de uploads simultâneos
      if (activeUploadsRef.current.size >= maxConcurrent) return;

      // Marcar como em upload
      activeUploadsRef.current.add(nextItem.id);
      setQueue(prev => prev.map(q =>
        q.id === nextItem.id ? { ...q, status: 'uploading' as const } : q
      ));

      try {
        // Fazer upload
        const result = await uploadSingleFile(nextItem);

        // Sucesso
        setQueue(prev => prev.map(q =>
          q.id === nextItem.id
            ? { ...q, status: 'success' as const, result, progress: 100 }
            : q
        ));

        results.push(result);
        onFileComplete?.(result);

      } catch (error: any) {
        console.error(`Error uploading ${nextItem.file.name}:`, error);

        // Verificar se deve tentar novamente
        const shouldRetry = (nextItem.retryCount || 0) < maxRetries;

        if (shouldRetry) {
          // Marcar para retry
          setQueue(prev => prev.map(q =>
            q.id === nextItem.id
              ? { ...q, status: 'pending' as const, retryCount: (q.retryCount || 0) + 1 }
              : q
          ));
        } else {
          // Falha definitiva
          setQueue(prev => prev.map(q =>
            q.id === nextItem.id
              ? { ...q, status: 'error' as const, error: error.message }
              : q
          ));
          failed.push({ ...nextItem, error: error.message });
        }
      } finally {
        activeUploadsRef.current.delete(nextItem.id);

        // Calcular progresso geral
        const completedCount = queue.filter(q => 
          q.status === 'success' || q.status === 'error'
        ).length + 1;
        const totalCount = queue.length;
        const overallProgress = (completedCount / totalCount) * 100;
        onProgress?.(overallProgress);
      }
    };

    // Processar fila até concluir
    const processLoop = async () => {
      while (true) {
        const pendingItems = queue.filter(item => item.status === 'pending');
        const uploadingItems = queue.filter(item => item.status === 'uploading');

        // Se não há mais itens pendentes ou em upload, terminar
        if (pendingItems.length === 0 && uploadingItems.length === 0) {
          break;
        }

        // Iniciar uploads até o limite de concorrência
        const availableSlots = maxConcurrent - activeUploadsRef.current.size;
        const itemsToStart = Math.min(availableSlots, pendingItems.length);

        const promises = [];
        for (let i = 0; i < itemsToStart; i++) {
          promises.push(processNext());
        }

        await Promise.all(promises);

        // Pequeno delay antes de verificar novamente
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };

    await processLoop();

    setIsUploading(false);

    // Notificar conclusão
    if (results.length > 0 || failed.length > 0) {
      onComplete?.({ successful: results, failed });
      
      if (results.length > 0) {
        toast.success(`${results.length} arquivo(s) enviado(s) com sucesso!`);
      }
      
      if (failed.length > 0) {
        toast.error(`${failed.length} arquivo(s) falharam no envio.`);
      }
    }

  }, [queue, isUploading, maxConcurrent, maxRetries, uploadSingleFile, onComplete, onFileComplete, onProgress]);

  /**
   * Cancela um upload específico
   */
  const cancelUpload = useCallback((itemId: string) => {
    const abortController = abortControllersRef.current.get(itemId);
    if (abortController) {
      abortController.abort();
    }

    setQueue(prev => prev.map(q =>
      q.id === itemId ? { ...q, status: 'error' as const, error: 'Cancelado pelo usuário' } : q
    ));

    activeUploadsRef.current.delete(itemId);
  }, []);

  /**
   * Tenta novamente um upload que falhou
   */
  const retryUpload = useCallback((itemId: string) => {
    setQueue(prev => prev.map(q =>
      q.id === itemId ? { ...q, status: 'pending' as const, error: undefined, progress: 0 } : q
    ));
  }, []);

  /**
   * Limpa a fila
   */
  const clearQueue = useCallback(() => {
    // Cancelar todos os uploads ativos
    abortControllersRef.current.forEach(controller => controller.abort());
    abortControllersRef.current.clear();
    activeUploadsRef.current.clear();

    setQueue([]);
    setIsUploading(false);
  }, []);

  /**
   * Remove um item da fila
   */
  const removeFromQueue = useCallback((itemId: string) => {
    cancelUpload(itemId);
    setQueue(prev => prev.filter(q => q.id !== itemId));
  }, [cancelUpload]);

  // Calcular estatísticas
  const stats = {
    total: queue.length,
    completed: queue.filter(q => q.status === 'success').length,
    failed: queue.filter(q => q.status === 'error').length,
    uploading: queue.filter(q => q.status === 'uploading').length,
    pending: queue.filter(q => q.status === 'pending').length,
    progress: queue.length > 0
      ? queue.reduce((acc, item) => acc + item.progress, 0) / queue.length
      : 0
  };

  return {
    queue,
    isUploading,
    stats,
    addFiles,
    startUpload: processQueue,
    cancelUpload,
    retryUpload,
    removeFromQueue,
    clearQueue
  };
}

