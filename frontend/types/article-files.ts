import {FileFormat, FileRole} from '@/lib/file-constants';

/**
 * Tipos TypeScript para o sistema de arquivos de artigos
 * 
 * IMPORTANTE:
 * - file_type = formato do arquivo (PDF, DOC, etc.)
 * - file_role = função do arquivo (MAIN, SUPPLEMENT, etc.)
 */

export interface ArticleFile {
  id: string;
  project_id: string;
  article_id: string;
  file_type: string;   // Formato: PDF, DOC, DOCX, etc.
  file_role?: string;  // Função: MAIN, SUPPLEMENT, etc.
  storage_key: string;
  original_filename: string | null;
  bytes: number | null;
  md5: string | null;
  // Campos para extração de texto (implementação futura)
  text_raw?: string | null;           // Texto puro extraído
  text_html?: string | null;          // Texto com HTML extraído
  extraction_status?: string | null;  // pending, processing, completed, failed
  extraction_error?: string | null;   // Mensagem de erro se falhar
  extracted_at?: string | null;       // Data/hora da extração
  created_at: string;
  updated_at: string;
}

export interface ArticleFileInsert {
  project_id: string;
  article_id: string;
  file_type: FileFormat | string; // Formato detectado automaticamente
  file_role: FileRole | string;   // Função selecionada pelo usuário
  storage_key: string;
  original_filename: string;
  bytes: number;
  md5?: string | null;
}

export interface FileUploadProgress {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  articleFileId?: string;
}

export interface FileUploadResult {
  success: boolean;
  articleFile?: ArticleFile;
  error?: string;
}

export interface MultiFileUploadResult {
  successful: ArticleFile[];
  failed: Array<{
    file: File;
    error: string;
  }>;
}

