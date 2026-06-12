/**
 * Hook to manage multiple file uploads
 *
 * Features:
 * - Upload queue with parallel processing
 * - Concurrency control
 * - Per-file progress tracking
 * - Automatic retry on failure
 * - Upload cancellation
 * - Real-time statistics
 */

import {useRef, useState} from 'react';
import {uploadQueuedFile} from '@/services/fileUploadService';
import {toast} from 'sonner';
import {validateFile} from '@/lib/file-validation';
import {FILE_ERROR_MESSAGES, type FileRole} from '@/lib/file-constants';
import {t} from '@/lib/copy';
import type {ArticleFile} from '@/types/article-files';

export interface UploadQueueItem {
  id: string;
  file: File;
  fileRole: FileRole;
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
   * Maximum concurrent uploads
   */
  maxConcurrent?: number;

  /**
   * Maximum retry attempts on failure
   */
  maxRetries?: number;

  /**
   * Callback when all uploads complete
   */
  onComplete?: (results: { successful: ArticleFile[]; failed: UploadQueueItem[] }) => void;

  /**
   * Callback for each completed file
   */
  onFileComplete?: (result: ArticleFile) => void;

  /**
   * Callback for overall progress
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
   * Adds files to the queue
   */
  const addFiles = (files: File[], fileRole: FileRole) => {
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
  };

  /**
   * Uploads a single file — delegates IO (and try/finally) to the service.
   */
  const uploadSingleFile = async (item: UploadQueueItem): Promise<ArticleFile> => {
    // Pre-validate so invalid files fail immediately without hitting the network.
    const validation = validateFile(item.file);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid file');
    }

    // IO including try/finally cleanup lives in fileUploadService.uploadQueuedFile
    return uploadQueuedFile({
      projectId,
      articleId,
      fileRole: item.fileRole,
      abortControllersRef: abortControllersRef.current,
      itemId: item.id,
      file: item.file,
      onProgress: (progress, uploadedBytes, speed, startTime) => {
        setQueue(prev => prev.map(q =>
          q.id === item.id
            ? { ...q, progress, uploadedSize: uploadedBytes, speed, startTime }
            : q
        ));
      },
    });
  };

  /**
   * Processes the upload queue
   */
  const processQueue = async () => {
    if (isUploading) return;

    setIsUploading(true);
    const results: ArticleFile[] = [];
    const failed: UploadQueueItem[] = [];

    const processNext = async (): Promise<void> => {
      // Find next pending item
      const nextItem = queue.find(
        item => item.status === 'pending' && !activeUploadsRef.current.has(item.id)
      );

      if (!nextItem) return;

      // Check concurrent upload limit
      if (activeUploadsRef.current.size >= maxConcurrent) return;

      // Mark as uploading
      activeUploadsRef.current.add(nextItem.id);
      setQueue(prev => prev.map(q =>
        q.id === nextItem.id ? { ...q, status: 'uploading' as const } : q
      ));

      const result = await uploadSingleFile(nextItem).then(
        (articleFile) => ({ok: true as const, articleFile}),
        (error: unknown) => ({ok: false as const, error: error instanceof Error ? error.message : FILE_ERROR_MESSAGES.UPLOAD_FAILED}),
      );

      if (result.ok) {
        setQueue(prev => prev.map(q =>
          q.id === nextItem.id
            ? { ...q, status: 'success' as const, result: result.articleFile, progress: 100 }
            : q
        ));
        results.push(result.articleFile);
        onFileComplete?.(result.articleFile);
      } else {
        console.error(`Error uploading ${nextItem.file.name}:`, result.error);
        const shouldRetry = (nextItem.retryCount || 0) < maxRetries;

        if (shouldRetry) {
          setQueue(prev => prev.map(q =>
            q.id === nextItem.id
              ? { ...q, status: 'pending' as const, retryCount: (q.retryCount || 0) + 1 }
              : q
          ));
        } else {
          setQueue(prev => prev.map(q =>
            q.id === nextItem.id
              ? { ...q, status: 'error' as const, error: result.error }
              : q
          ));
          failed.push({ ...nextItem, error: result.error });
        }
      }

      activeUploadsRef.current.delete(nextItem.id);

      // Calculate overall progress
      const completedCount = queue.filter(q =>
        q.status === 'success' || q.status === 'error'
      ).length + 1;
      const totalCount = queue.length;
      const overallProgress = (completedCount / totalCount) * 100;
      onProgress?.(overallProgress);
    };

    // Process queue until done
    const processLoop = async () => {
      while (true) {
        const pendingItems = queue.filter(item => item.status === 'pending');
        const uploadingItems = queue.filter(item => item.status === 'uploading');

        // If no more pending or uploading items, finish
        if (pendingItems.length === 0 && uploadingItems.length === 0) {
          break;
        }

        // Start uploads up to concurrency limit
        const availableSlots = maxConcurrent - activeUploadsRef.current.size;
        const itemsToStart = Math.min(availableSlots, pendingItems.length);

        const promises = [];
        for (let i = 0; i < itemsToStart; i++) {
          promises.push(processNext());
        }

        await Promise.all(promises);

        // Short delay before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };

    await processLoop();

    setIsUploading(false);

    // Notify completion
    if (results.length > 0 || failed.length > 0) {
      onComplete?.({ successful: results, failed });

      if (results.length > 0) {
        toast.success(`${results.length} file(s) uploaded successfully!`);
      }

      if (failed.length > 0) {
        toast.error(`${failed.length} file(s) failed to upload.`);
      }
    }

  };

  /**
   * Cancels a specific upload
   */
  const cancelUpload = (itemId: string) => {
    const abortController = abortControllersRef.current.get(itemId);
    if (abortController) {
      abortController.abort();
    }

    setQueue(prev => prev.map(q =>
      q.id === itemId ? {...q, status: 'error' as const, error: t('extraction', 'cancelledByUser')} : q
    ));

    activeUploadsRef.current.delete(itemId);
  };

  /**
   * Retries a failed upload
   */
  const retryUpload = (itemId: string) => {
    setQueue(prev => prev.map(q =>
      q.id === itemId ? { ...q, status: 'pending' as const, error: undefined, progress: 0 } : q
    ));
  };

  /**
   * Clears the queue
   */
  const clearQueue = () => {
    // Cancel all active uploads
    abortControllersRef.current.forEach(controller => controller.abort());
    abortControllersRef.current.clear();
    activeUploadsRef.current.clear();

    setQueue([]);
    setIsUploading(false);
  };

  /**
   * Removes an item from the queue
   */
  const removeFromQueue = (itemId: string) => {
    cancelUpload(itemId);
    setQueue(prev => prev.filter(q => q.id !== itemId));
  };

  // Calculate statistics
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
