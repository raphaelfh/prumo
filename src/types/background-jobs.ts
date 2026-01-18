/**
 * Types para Background Jobs (tarefas em background)
 * 
 * Sistema para gerenciar tarefas de longa duração que rodam em background,
 * permitindo o usuário continuar usando a aplicação enquanto elas executam.
 */

export type JobType = 'zotero-import';

export type JobStatus = 
  | 'pending'      // Aguardando início
  | 'running'      // Em execução
  | 'completed'    // Concluída com sucesso
  | 'failed'       // Falhou com erro
  | 'cancelled';   // Cancelada pelo usuário

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
 * Background Job genérico
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
 * Importação do Zotero específica
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
 * Helper para criar novo job
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

