
export interface ZoteroIntegration {
  id: string;
  user_id: string;
  zotero_user_id: string;
  library_type: string;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZoteroCredentialsInput {
  zoteroUserId: string;
  apiKey: string;
  libraryType: 'user' | 'group';
  [key: string]: unknown;
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


// =================== ITEMS (ARTIGOS) ===================




// =================== ATTACHMENTS ===================


// =================== IMPORT ===================

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
    currentFile?: string; // Name of file currently being processed
  stats: {
    imported: number;
    updated: number;
    skipped: number;
    errors: number;
      removedAtSource?: number;
      reactivated?: number;
      pdfsDownloaded?: number; // Count of PDFs downloaded
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
      removedAtSource?: number;
      reactivated?: number;
      pdfsDownloaded?: number;
  };
  errors: ImportError[];
  duration: number;
}

interface ZoteroSyncCounts {
    totalReceived: number;
    persisted: number;
    updated: number;
    skipped: number;
    failed: number;
    removedAtSource: number;
    reactivated: number;
}

export interface ZoteroSyncStatus {
    syncRunId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    counts: ZoteroSyncCounts;
    startedAt: string;
    completedAt?: string | null;
    traceId: string;
}

// =================== MAPEAMENTO DE ARTIGOS ===================


// =================== RESPOSTAS DA API ===================


export interface ZoteroTestConnectionResult {
  success: boolean;
  userName?: string;
  error?: string;
}

