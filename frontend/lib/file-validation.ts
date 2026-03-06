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
 * Detects file format from MIME type and extension
 */
export function detectFileFormat(file: File): FileFormat {
    // Try MIME type first
  if (file.type && MIME_TYPE_TO_FORMAT[file.type]) {
    return MIME_TYPE_TO_FORMAT[file.type];
  }

    // Fallback: detect by extension
  const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
  if (EXTENSION_TO_FORMAT[extension]) {
    return EXTENSION_TO_FORMAT[extension];
  }

    // If not detected, return OTHER
  return FILE_FORMATS.OTHER;
}

/**
 * Validates a file before upload
 */
export function validateFile(file: File | null): FileValidationResult {
  if (!file) {
    return {
      valid: false,
      error: FILE_ERROR_MESSAGES.NO_FILE_SELECTED
    };
  }

    // Validate size
  if (file.size > FILE_UPLOAD_CONFIG.MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: FILE_ERROR_MESSAGES.FILE_TOO_LARGE
    };
  }

    // Validate MIME type
  let isValidType = FILE_UPLOAD_CONFIG.ALLOWED_MIME_TYPES.includes(file.type);
  
  if (!isValidType) {
      // Validate by extension as fallback
    const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
    isValidType = FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS.includes(extension);
    
    if (!isValidType) {
      return {
        valid: false,
          error: `${FILE_ERROR_MESSAGES.INVALID_TYPE}. Allowed types: ${FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}`
      };
    }
  }

    // Detect format automatically
  const detectedFormat = detectFileFormat(file);

  return {
    valid: true,
    file,
    detectedFormat
  };
}

/**
 * Validates multiple files
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
 * Generates a unique, safe storage key
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
 * Formats file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

