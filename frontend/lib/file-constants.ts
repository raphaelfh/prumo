/**
 * Constants for article-linked files
 *
 * IMPORTANT:
 * - file_type = FILE FORMAT (PDF, DOC, DOCX, etc.)
 * - file_role = FILE ROLE (Main, Supplement, etc.)
 */

/**
 * File role in the article
 */
export const FILE_ROLES = {
  MAIN: 'MAIN',
  SUPPLEMENT: 'SUPPLEMENT',
  PROTOCOL: 'PROTOCOL',
  DATASET: 'DATASET',
  APPENDIX: 'APPENDIX',
  FIGURE: 'FIGURE',
  OTHER: 'OTHER'
} as const;

export type FileRole = typeof FILE_ROLES[keyof typeof FILE_ROLES];

export const FILE_ROLE_LABELS: Record<FileRole, string> = {
    [FILE_ROLES.MAIN]: 'Main file',
    [FILE_ROLES.SUPPLEMENT]: 'Supplemental material',
    [FILE_ROLES.PROTOCOL]: 'Protocol',
    [FILE_ROLES.DATASET]: 'Dataset',
    [FILE_ROLES.APPENDIX]: 'Appendix',
    [FILE_ROLES.FIGURE]: 'Figure / Image',
    [FILE_ROLES.OTHER]: 'Other',
};

export const FILE_ROLE_DESCRIPTIONS: Record<FileRole, string> = {
    [FILE_ROLES.MAIN]: 'Main article file (PDF, DOC, etc.)',
    [FILE_ROLES.SUPPLEMENT]: 'Supplemental material, additional appendices',
    [FILE_ROLES.PROTOCOL]: 'Research protocol or methodology',
    [FILE_ROLES.DATASET]: 'Dataset, spreadsheets, data files',
    [FILE_ROLES.APPENDIX]: 'Article appendix or attachment',
    [FILE_ROLES.FIGURE]: 'Figures, charts or high-resolution images',
    [FILE_ROLES.OTHER]: 'Other related file types',
};

/**
 * Formatos de arquivo suportados
 */
export const FILE_FORMATS = {
  PDF: 'PDF',
  DOC: 'DOC',
  DOCX: 'DOCX',
  TXT: 'TXT',
  CSV: 'CSV',
  XLSX: 'XLSX',
  XLS: 'XLS',
  PNG: 'PNG',
  JPG: 'JPG',
  JPEG: 'JPEG',
  SVG: 'SVG',
  OTHER: 'OTHER'
} as const;

export type FileFormat = typeof FILE_FORMATS[keyof typeof FILE_FORMATS];

/**
 * MIME type to format mapping
 */
export const MIME_TYPE_TO_FORMAT: Record<string, FileFormat> = {
  'application/pdf': FILE_FORMATS.PDF,
  'application/msword': FILE_FORMATS.DOC,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FILE_FORMATS.DOCX,
  'text/plain': FILE_FORMATS.TXT,
  'text/csv': FILE_FORMATS.CSV,
  'application/vnd.ms-excel': FILE_FORMATS.XLS,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FILE_FORMATS.XLSX,
  'image/png': FILE_FORMATS.PNG,
  'image/jpeg': FILE_FORMATS.JPG,
  'image/jpg': FILE_FORMATS.JPEG,
  'image/svg+xml': FILE_FORMATS.SVG
};

/**
 * Extension to format mapping
 */
export const EXTENSION_TO_FORMAT: Record<string, FileFormat> = {
  '.pdf': FILE_FORMATS.PDF,
  '.doc': FILE_FORMATS.DOC,
  '.docx': FILE_FORMATS.DOCX,
  '.txt': FILE_FORMATS.TXT,
  '.csv': FILE_FORMATS.CSV,
  '.xls': FILE_FORMATS.XLS,
  '.xlsx': FILE_FORMATS.XLSX,
  '.png': FILE_FORMATS.PNG,
  '.jpg': FILE_FORMATS.JPG,
  '.jpeg': FILE_FORMATS.JPEG,
  '.svg': FILE_FORMATS.SVG
};

/**
 * File validation settings
 */
export const FILE_UPLOAD_CONFIG = {
  MAX_SIZE_MB: 50,
  MAX_SIZE_BYTES: 50 * 1024 * 1024,
  ALLOWED_MIME_TYPES: Object.keys(MIME_TYPE_TO_FORMAT),
  ALLOWED_EXTENSIONS: Object.keys(EXTENSION_TO_FORMAT)
} as const;

/**
 * Standardized error messages
 */
export const FILE_ERROR_MESSAGES = {
    FILE_TOO_LARGE: `File too large. Maximum size: ${FILE_UPLOAD_CONFIG.MAX_SIZE_MB}MB`,
    INVALID_TYPE: 'File type not allowed',
    UPLOAD_FAILED: 'Error uploading file',
    STORAGE_ERROR: 'Error saving file to storage',
    DATABASE_ERROR: 'Error registering file in database',
    NO_FILE_SELECTED: 'No file selected',
    DUPLICATE_FILE: 'File already exists for this article',
} as const;

