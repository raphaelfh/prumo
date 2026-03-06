import {useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {detectFileFormat, generateStorageKey, validateFile} from '@/lib/file-validation';
import {FILE_ERROR_MESSAGES} from '@/lib/file-constants';
import type {ArticleFileInsert, FileUploadProgress, FileUploadResult} from '@/types/article-files';

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
    fileRole: string
  ): Promise<FileUploadResult> => {
      // Validate file and detect format automatically
    const validation = validateFile(file);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    // Detectar formato do arquivo automaticamente
    const detectedFormat = validation.detectedFormat || detectFileFormat(file);

    // Gerar chave de storage
    const storageKey = generateStorageKey(projectId, articleId, file.name);

    try {
      // Upload para o storage
      const { error: uploadError } = await supabase.storage
        .from('articles')
        .upload(storageKey, file);

      if (uploadError) {
        throw new Error(FILE_ERROR_MESSAGES.STORAGE_ERROR + ': ' + uploadError.message);
      }

      // Inserir registro no banco
      const articleFileData: ArticleFileInsert = {
        project_id: projectId,
        article_id: articleId,
        file_type: detectedFormat,  // Formato detectado automaticamente
          file_role: fileRole,         // Role selected by user
        storage_key: storageKey,
        original_filename: file.name,
        bytes: file.size,
        md5: null
      };

      const { data: articleFile, error: insertError } = await supabase
        .from('article_files')
        .insert(articleFileData)
        .select()
        .single();

      if (insertError) {
        // Rollback: remover arquivo do storage
        await supabase.storage.from('articles').remove([storageKey]);
        throw new Error(FILE_ERROR_MESSAGES.DATABASE_ERROR + ': ' + insertError.message);
      }

      return {
        success: true,
        articleFile
      };
    } catch (error: any) {
      console.error('Error uploading file:', error);
      return {
        success: false,
        error: error.message || FILE_ERROR_MESSAGES.UPLOAD_FAILED
      };
    }
  };

  /**
   * Uploads multiple files with progress tracking
   * @param files - Array de arquivos a serem enviados
   * @param projectId - ID do projeto
   * @param articleId - ID do artigo
   * @param fileRole - File role (all will have the same role)
   */
  const uploadMultipleFiles = async (
    files: File[],
    projectId: string,
    articleId: string,
    fileRole: string
  ) => {
    setUploading(true);
    
    // Inicializar progresso
    const initialProgress: FileUploadProgress[] = files.map(file => ({
      file,
      progress: 0,
      status: 'pending'
    }));
    setProgress(initialProgress);

    const results = await Promise.all(
      files.map(async (file, index) => {
        // Atualizar status para uploading
        setProgress(prev => 
          prev.map((p, i) => i === index ? { ...p, status: 'uploading' as const } : p)
        );

        const result = await uploadFile(file, projectId, articleId, fileRole);

        // Atualizar status baseado no resultado
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
   * Limpa o progresso de upload
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
