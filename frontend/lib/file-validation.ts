import {
    EXTENSION_TO_FORMAT,
    FILE_ERROR_MESSAGES,
    FILE_FORMATS,
    FILE_UPLOAD_CONFIG,
    type FileFormat,
    MIME_TYPE_TO_FORMAT
} from './file-constants';

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  file?: File;
  detectedFormat?: FileFormat;
}

/**
 * Detecta o formato do arquivo baseado no MIME type e extensão
 */
export function detectFileFormat(file: File): FileFormat {
  // Tentar pelo MIME type primeiro
  if (file.type && MIME_TYPE_TO_FORMAT[file.type]) {
    return MIME_TYPE_TO_FORMAT[file.type];
  }

  // Fallback: detectar pela extensão
  const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
  if (EXTENSION_TO_FORMAT[extension]) {
    return EXTENSION_TO_FORMAT[extension];
  }

  // Se não detectar, retornar OTHER
  return FILE_FORMATS.OTHER;
}

/**
 * Valida um arquivo antes do upload
 */
export function validateFile(file: File | null): FileValidationResult {
  if (!file) {
    return {
      valid: false,
      error: FILE_ERROR_MESSAGES.NO_FILE_SELECTED
    };
  }

  // Validar tamanho
  if (file.size > FILE_UPLOAD_CONFIG.MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: FILE_ERROR_MESSAGES.FILE_TOO_LARGE
    };
  }

  // Validar tipo MIME
  let isValidType = FILE_UPLOAD_CONFIG.ALLOWED_MIME_TYPES.includes(file.type);
  
  if (!isValidType) {
    // Validar por extensão como fallback
    const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
    isValidType = FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS.includes(extension);
    
    if (!isValidType) {
      return {
        valid: false,
        error: `${FILE_ERROR_MESSAGES.INVALID_TYPE}. Tipos permitidos: ${FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}`
      };
    }
  }

  // Detectar formato automaticamente
  const detectedFormat = detectFileFormat(file);

  return {
    valid: true,
    file,
    detectedFormat
  };
}

/**
 * Valida múltiplos arquivos
 */
export function validateFiles(files: File[]): {
  valid: File[];
  invalid: Array<{ file: File; error: string }>;
} {
  const valid: File[] = [];
  const invalid: Array<{ file: File; error: string }> = [];

  files.forEach(file => {
    const result = validateFile(file);
    if (result.valid && result.file) {
      valid.push(result.file);
    } else if (result.error) {
      invalid.push({ file, error: result.error });
    }
  });

  return { valid, invalid };
}

/**
 * Gera uma chave de storage única e segura
 */
export function generateStorageKey(
  projectId: string,
  articleId: string,
  filename: string
): string {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 11);
  const extension = filename.split('.').pop();
  const safeFilename = `${timestamp}-${randomString}.${extension}`;
  
  return `${projectId}/${articleId}/${safeFilename}`;
}

/**
 * Formata o tamanho do arquivo para exibição
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

