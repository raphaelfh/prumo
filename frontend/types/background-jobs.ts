/**
 * Types for background jobs
 *
 * System for managing long-running tasks in the background,
 * allowing the user to keep using the app while they run.
 */

export type JobType = 'zotero-import' | 'articles-export';

export type JobStatus =
    | 'pending'      // Waiting to start
    | 'running'      // Running
    | 'completed'    // Completed successfully
    | 'failed'       // Failed with error
    | 'cancelled';   // Cancelled by user

export interface JobProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
  currentFile?: string;
}

export interface JobStats {
  imported?: number;
  updated?: number;
  skipped?: number;
  errors?: number;
  pdfsDownloaded?: number;
}

/**
 * Generic background job
 */
export interface BackgroundJob {
  id: string;
  type: JobType;
  status: JobStatus;
  progress?: JobProgress;
  stats?: JobStats;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata: Record<string, any>;
}

/**
 * Zotero import specific
 */
export interface ZoteroImportJob extends BackgroundJob {
  type: 'zotero-import';
  metadata: {
    projectId: string;
    projectName?: string;
    collectionKey: string;
    collectionName?: string;
    options: {
      downloadPdfs: boolean;
      onlyPdfs?: boolean;
      updateExisting: boolean;
      importTags: boolean;
    };
  };
}

/**
 * Articles export specific
 */
export interface ArticlesExportJob extends BackgroundJob {
    type: 'articles-export';
    metadata: {
        projectId: string;
        projectName?: string;
        backendJobId: string;
        formats: Array<'csv' | 'ris' | 'rdf'>;
        fileScope: 'none' | 'main_only' | 'all';
        articleCount: number;
        downloadUrl?: string;
    };
}

/**
 * Helper to create a new job
 */
export function createZoteroImportJob(
  projectId: string,
  collectionKey: string,
  options: ZoteroImportJob['metadata']['options'],
  metadata?: Partial<ZoteroImportJob['metadata']>
): ZoteroImportJob {
  return {
    id: `zotero-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'zotero-import',
    status: 'pending',
    createdAt: Date.now(),
    metadata: {
      projectId,
      collectionKey,
      options,
      ...metadata,
    },
  };
}

/**
 * Helper to create a new articles export background job
 */
export function createArticlesExportJob(
    projectId: string,
    backendJobId: string,
    metadata: Omit<ArticlesExportJob['metadata'], 'projectId' | 'backendJobId'>
): ArticlesExportJob {
    return {
        id: `articles-export-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        type: 'articles-export',
        status: 'pending',
        createdAt: Date.now(),
        metadata: {
            projectId,
            backendJobId,
            ...metadata,
        },
    };
}

