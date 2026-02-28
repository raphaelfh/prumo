/**
 * Constantes para arquivos vinculados a artigos
 * 
 * IMPORTANTE: 
 * - file_type = FORMATO do arquivo (PDF, DOC, DOCX, etc.)
 * - file_role = FUNÇÃO/PAPEL do arquivo (Principal, Suplementar, etc.)
 */

/**
 * Papel/função do arquivo no artigo
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
  [FILE_ROLES.MAIN]: 'Arquivo Principal',
  [FILE_ROLES.SUPPLEMENT]: 'Material Suplementar',
  [FILE_ROLES.PROTOCOL]: 'Protocolo',
  [FILE_ROLES.DATASET]: 'Dataset/Dados',
  [FILE_ROLES.APPENDIX]: 'Apêndice',
  [FILE_ROLES.FIGURE]: 'Figura/Imagem',
  [FILE_ROLES.OTHER]: 'Outro'
};

export const FILE_ROLE_DESCRIPTIONS: Record<FileRole, string> = {
  [FILE_ROLES.MAIN]: 'Arquivo principal do artigo (PDF, DOC, etc.)',
  [FILE_ROLES.SUPPLEMENT]: 'Material suplementar, apêndices adicionais',
  [FILE_ROLES.PROTOCOL]: 'Protocolo de pesquisa ou metodologia',
  [FILE_ROLES.DATASET]: 'Conjunto de dados, planilhas, arquivos de dados',
  [FILE_ROLES.APPENDIX]: 'Apêndice ou anexo do artigo',
  [FILE_ROLES.FIGURE]: 'Figuras, gráficos ou imagens em alta resolução',
  [FILE_ROLES.OTHER]: 'Outros tipos de arquivos relacionados'
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
 * Mapeamento de MIME types para formatos
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
 * Mapeamento de extensões para formatos
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
 * Configurações de validação de arquivo
 */
export const FILE_UPLOAD_CONFIG = {
  MAX_SIZE_MB: 50,
  MAX_SIZE_BYTES: 50 * 1024 * 1024,
  ALLOWED_MIME_TYPES: Object.keys(MIME_TYPE_TO_FORMAT),
  ALLOWED_EXTENSIONS: Object.keys(EXTENSION_TO_FORMAT)
} as const;

/**
 * Mensagens de erro padronizadas
 */
export const FILE_ERROR_MESSAGES = {
  FILE_TOO_LARGE: `Arquivo muito grande. Tamanho máximo: ${FILE_UPLOAD_CONFIG.MAX_SIZE_MB}MB`,
  INVALID_TYPE: 'Tipo de arquivo não permitido',
  UPLOAD_FAILED: 'Erro ao fazer upload do arquivo',
  STORAGE_ERROR: 'Erro ao salvar arquivo no storage',
  DATABASE_ERROR: 'Erro ao registrar arquivo no banco de dados',
  NO_FILE_SELECTED: 'Nenhum arquivo selecionado',
  DUPLICATE_FILE: 'Arquivo já existe para este artigo'
} as const;

