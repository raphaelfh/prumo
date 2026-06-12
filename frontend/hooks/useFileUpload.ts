import {useState} from 'react';
import {uploadArticleFile} from '@/services/fileUploadService';
import {FILE_ERROR_MESSAGES} from '@/lib/file-constants';
import type {FileRole} from '@/lib/file-constants';
import type {FileUploadProgress, FileUploadResult} from '@/types/article-files';

/**
 * Reusable hook for article file uploads
 * Centralizes validation, upload and error handling
 *
 * IMPORTANT:
 * - fileRole = file role (MAIN, SUPPLEMENT, etc.) - SELECTED BY USER
 * - fileType = file format (PDF, DOC, etc.) - DETECTED AUTOMATICALLY
 */
export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<FileUploadProgress[]>([]);

  /**
   * Uploads a single file
   * @param file - File to upload
   * @param projectId - Project ID
   * @param articleId - Article ID
   * @param fileRole - File role (MAIN, SUPPLEMENT, etc.)
   */
  const uploadFile = async (
    file: File,
    projectId: string,
    articleId: string,
    fileRole: FileRole
  ): Promise<FileUploadResult> => {
    // IO relocated to fileUploadService.uploadArticleFile (no try/catch here)
    return uploadArticleFile(file, projectId, articleId, fileRole);
  };

  /**
   * Uploads multiple files with progress tracking
   * @param files - Array of files to upload
   * @param projectId - Project ID
   * @param articleId - Article ID
   * @param fileRole - File role (all will have the same role)
   */
  const uploadMultipleFiles = async (
    files: File[],
    projectId: string,
    articleId: string,
    fileRole: FileRole
  ) => {
    setUploading(true);

    // Initialize progress
    const initialProgress: FileUploadProgress[] = files.map(file => ({
      file,
      progress: 0,
      status: 'pending'
    }));
    setProgress(initialProgress);

    const results = await Promise.all(
      files.map(async (file, index) => {
        // Update status to uploading
        setProgress(prev =>
          prev.map((p, i) => i === index ? { ...p, status: 'uploading' as const } : p)
        );

        const result = await uploadFile(file, projectId, articleId, fileRole);

        // Update status based on result
        setProgress(prev =>
          prev.map((p, i) =>
            i === index
              ? {
                  ...p,
                  status: result.success ? ('success' as const) : ('error' as const),
                  progress: 100,
                  error: result.error,
                  articleFileId: result.articleFile?.id
                }
              : p
          )
        );

        return result;
      })
    );

    setUploading(false);

    const successful = results.filter(r => r.success && r.articleFile).map(r => r.articleFile!);
    const failed = results
      .map((r, i) => ({ result: r, file: files[i] }))
      .filter(({ result }) => !result.success)
      .map(({ result, file }) => ({ file, error: result.error || FILE_ERROR_MESSAGES.UPLOAD_FAILED }));

    return { successful, failed };
  };

  /**
   * Clears upload progress
   */
  const clearProgress = () => {
    setProgress([]);
  };

  return {
    uploadFile,
    uploadMultipleFiles,
    uploading,
    progress,
    clearProgress
  };
}
