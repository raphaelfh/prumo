/**
 * Tipos TypeScript para integração com Zotero API
 * Baseado na API v3: https://www.zotero.org/support/dev/web_api/v3/start
 */

// =================== CREDENCIAIS E CONFIGURAÇÃO ===================

export interface ZoteroCredentials {
  userId: string;
  apiKey: string;
  libraryType: 'user' | 'group';
}

export interface ZoteroIntegration {
  id: string;
  user_id: string;
  zotero_user_id: string;
  library_type: 'user' | 'group';
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZoteroCredentialsInput {
  zoteroUserId: string;
  apiKey: string;
  libraryType: 'user' | 'group';
}

// =================== COLLECTIONS ===================

export interface ZoteroCollection {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
    name: string;
  };
  data: {
    key: string;
    version: number;
    name: string;
    parentCollection: string | false;
    relations: Record<string, unknown>;
  };
  meta: {
    numCollections?: number;
    numItems?: number;
  };
}

export interface ZoteroCollectionTree extends ZoteroCollection {
  children?: ZoteroCollectionTree[];
  level?: number;
}

// =================== ITEMS (ARTIGOS) ===================

export interface ZoteroCreator {
  creatorType: 'author' | 'editor' | 'contributor' | string;
  firstName?: string;
  lastName?: string;
  name?: string; // Para organizações
}

export interface ZoteroTag {
  tag: string;
  type?: number;
}

export interface ZoteroItem {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
    name: string;
  };
  data: {
    key: string;
    version: number;
    itemType: string;
    title?: string;
    creators?: ZoteroCreator[];
    abstractNote?: string;
    publicationTitle?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    date?: string;
    series?: string;
    seriesTitle?: string;
    seriesText?: string;
    journalAbbreviation?: string;
    language?: string;
    DOI?: string;
    ISSN?: string;
    shortTitle?: string;
    url?: string;
    accessDate?: string;
    archive?: string;
    archiveLocation?: string;
    libraryCatalog?: string;
    callNumber?: string;
    rights?: string;
    extra?: string;
    tags?: ZoteroTag[];
    collections?: string[];
    relations?: Record<string, unknown>;
    dateAdded?: string;
    dateModified?: string;
  };
  meta?: {
    creatorSummary?: string;
    parsedDate?: string;
    numChildren?: number;
  };
}

// =================== ATTACHMENTS ===================

export interface ZoteroAttachment {
  key: string;
  version: number;
  library: {
    type: string;
    id: number;
    name: string;
  };
  data: {
    key: string;
    version: number;
    itemType: 'attachment';
    parentItem: string;
    linkMode: 'imported_file' | 'imported_url' | 'linked_file' | 'linked_url';
    title: string;
    accessDate?: string;
    url?: string;
    note?: string;
    contentType: string;
    charset?: string;
    filename?: string;
    md5?: string;
    mtime?: number;
    tags?: ZoteroTag[];
    relations?: Record<string, unknown>;
    dateAdded?: string;
    dateModified?: string;
  };
  meta?: {
    numChildren?: number;
  };
}

// =================== IMPORTAÇÃO ===================

export interface ImportOptions {
  downloadPdfs: boolean;
  onlyPdfs: boolean; // Baixar apenas PDFs ou incluir HTML/outros formatos
  updateExisting: boolean;
  importTags: boolean;
  conflictResolution: 'skip' | 'update' | 'ask';
}

export interface ImportProgress {
  phase: 'fetching' | 'processing' | 'downloading' | 'complete' | 'error';
  current: number;
  total: number;
  message: string;
  currentFile?: string; // Nome do arquivo sendo processado no momento
  stats: {
    imported: number;
    updated: number;
    skipped: number;
    errors: number;
    pdfsDownloaded?: number; // Contador de PDFs baixados
  };
}

export interface ImportError {
  itemKey: string;
  itemTitle: string;
  error: string;
  phase: string;
}

export interface ImportResult {
  success: boolean;
  stats: {
    imported: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  errors: ImportError[];
  duration: number;
}

// =================== MAPEAMENTO DE ARTIGOS ===================

export interface ArticleFromZotero {
  title: string;
  abstract: string | null;
  authors: string[] | null;
  publication_year: number | null;
  publication_month: number | null;
  journal_title: string | null;
  journal_issn: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url_landing: string | null;
  keywords: string[] | null;
  article_type: string | null;
  language: string | null;
  zotero_item_key: string;
  zotero_collection_key: string | null;
  zotero_version: number;
  ingestion_source: 'ZOTERO';
  source_payload: Record<string, unknown>;
}

// =================== RESPOSTAS DA API ===================

export interface ZoteroApiError {
  message: string;
  statusCode: number;
  details?: unknown;
}

export interface ZoteroTestConnectionResult {
  success: boolean;
  userName?: string;
  error?: string;
}

