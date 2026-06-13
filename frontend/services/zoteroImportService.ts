/**
 * Zotero import service
 * Manages the full process of importing articles from Zotero into the project
 */

import {supabase} from '@/integrations/supabase/client';
import {type ZoteroAction, zoteroClient} from '@/integrations/api/client';
import type {
    ImportError,
    ImportOptions,
    ImportProgress,
    ImportResult,
    ZoteroCollection,
    ZoteroCredentialsInput,
    ZoteroIntegration,
    ZoteroSyncStatus,
    ZoteroTestConnectionResult,
} from '@/types/zotero';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import {t} from '@/lib/copy';

/**
 * Main class for managing Zotero import
 */
export class ZoteroImportService {
  private abortController: AbortController | null = null;

    async startSync(projectId: string, collectionKey: string, options: ImportOptions): Promise<{
        syncRunId: string;
        status: string;
        message: string;
    }> {
        const response = await this.callZoteroApi<{
            syncRunId?: string;
            sync_run_id?: string;
            status?: string;
            message?: string
        }>('sync-collection', {
            projectId,
            collectionKey,
            maxItems: 1000,
            includeAttachments: options.downloadPdfs,
            updateExisting: options.updateExisting,
        });
        return response as { syncRunId: string; status: string; message: string; };
    }

    async getSyncStatus(syncRunId: string): Promise<ZoteroSyncStatus> {
        return this.callZoteroApi('sync-status', {syncRunId});
    }

    async retryFailed(syncRunId: string, limit = 100): Promise<{
        syncRunId: string;
        retryOfSyncRunId: string;
        queuedItems: number;
    }> {
        return this.callZoteroApi('sync-retry-failed', {syncRunId, limit});
    }

    async getSyncItemResults(syncRunId: string, statusFilter?: string): Promise<{
        items: Array<{
            zoteroItemKey?: string;
            articleId?: string;
            status: string;
            errorCode?: string;
            errorMessage?: string;
            authorityRuleApplied?: string;
            processedAt: string;
        }>;
        total: number;
        offset: number;
        limit: number;
    }> {
        return this.callZoteroApi('sync-item-result', {
            syncRunId,
            statusFilter,
            offset: 0,
            limit: 50,
        });
    }

  /**
   * Calls the FastAPI backend.
   */
  private async callZoteroApi<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    return await zoteroClient<T>(action as ZoteroAction, payload);
  }

  /**
   * Saves Zotero credentials in the vault
   */
  async saveCredentials(credentials: ZoteroCredentialsInput): Promise<void> {
    await this.callZoteroApi('save-credentials', credentials);
  }

  /**
   * Tests connection to Zotero using stored credentials
   */
  async testConnection(): Promise<ZoteroTestConnectionResult> {
    try {
      const result = await this.callZoteroApi<{
        success: boolean;
        user_name?: string;
        userName?: string;
        error?: string;
      }>('test-connection');
      return {
        success: result.success,
        userName: result.user_name || result.userName,
        error: result.error,
      };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Lists collections available in the Zotero library
   */
  async listCollections(): Promise<ZoteroCollection[]> {
    const result = await this.callZoteroApi<{ collections: ZoteroCollection[] }>('list-collections');
    return result.collections || [];
  }

  /**
   * Imports articles from a Zotero collection
   */
  async importFromCollection(
    projectId: string,
    collectionKey: string,
    options: ImportOptions,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();

    const stats: ImportResult['stats'] = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      pdfsDownloaded: 0,
    };

    const errors: ImportError[] = [];

    try {
        const started = await this.startSync(projectId, collectionKey, options);
        const syncRunId = started.syncRunId;
        let lastStatus = 'pending';
        let lastTotal = 0;

        while (lastStatus === 'pending' || lastStatus === 'running') {
            const status = await this.getSyncStatus(syncRunId);
            lastStatus = status.status;
            stats.imported = status.counts.persisted;
            stats.updated = status.counts.updated;
            stats.skipped = status.counts.skipped;
            stats.errors = status.counts.failed;
            stats.removedAtSource = status.counts.removedAtSource;
            stats.reactivated = status.counts.reactivated;
            const total = status.counts.totalReceived;
            lastTotal = total;
            const current = status.counts.persisted + status.counts.updated + status.counts.skipped + status.counts.failed;
            const showCount = total > 0;

        onProgress?.({
            phase: lastStatus === 'completed' ? 'complete' : 'processing',
            current,
            total,
            message: lastStatus === 'completed'
                ? t('extraction', 'zoteroProgressComplete')
                : showCount
                    ? t('extraction', 'zoteroProgressProcessingCount').replace('{{current}}', String(current)).replace('{{total}}', String(total))
                    : t('extraction', 'zoteroProgressProcessing'),
            stats,
        });

            if (lastStatus === 'pending' || lastStatus === 'running') {
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        }

        if (lastStatus !== 'completed') {
            const diagnostics = await this.getSyncItemResults(syncRunId, 'failed');
            diagnostics.items.forEach((item) => {
                errors.push({
                    itemKey: item.zoteroItemKey || '',
                    itemTitle: item.zoteroItemKey || t('extraction', 'zoteroItemTitleFallback'),
                    error: item.errorMessage || 'Sync failed',
                    phase: 'processing',
                });
            });
            onProgress?.({
                phase: 'error',
                current: stats.imported + stats.updated + stats.skipped + stats.errors,
                total: lastTotal,
                message: t('extraction', 'zoteroProgressError'),
                stats,
            });
        }

      return {
          success: lastStatus === 'completed',
        stats,
        errors,
        duration: Date.now() - startTime,
      };

    } catch (error: any) {
      onProgress?.({
        phase: 'error',
        current: 0,
        total: 0,
          message: error.message || t('extraction', 'zoteroProgressError'),
        stats,
      });

      return {
        success: false,
        stats,
        errors: [
          ...errors,
          {
            itemKey: '',
              itemTitle: 'General error',
              error: error.message || 'Unknown error',
            phase: 'general',
          },
        ],
        duration: Date.now() - startTime,
      };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancels import in progress
   */
  cancelImport(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Removes Zotero credentials
   */
  async disconnect(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
        throw new Error('User not authenticated');
    }

      // Deactivate integration
    const { error } = await supabase
      .from('zotero_integrations')
      .update({ is_active: false })
      .eq('user_id', user.id);

    if (error) {
        throw new Error(`Failed to disconnect: ${error.message}`);
    }
  }
}

// Export singleton instance
export const zoteroService = new ZoteroImportService();

// ---------------------------------------------------------------------------
// ErrorResult wrappers — used by hooks so they contain no try-family statements
// (zero-bailouts spec, 2026-06-12)
// ---------------------------------------------------------------------------

export interface LoadZoteroIntegrationResult {
  integration: ZoteroIntegration | null;
  isConfigured: boolean;
}

/**
 * Load the active Zotero integration for the current user.
 * Supabase read relocated verbatim from useZoteroIntegration.loadIntegration.
 */
export function loadZoteroIntegration(): Promise<ErrorResult<LoadZoteroIntegrationResult>> {
  return toResult(async () => {
    const {data: {user}} = await supabase.auth.getUser();

    if (!user) {
      return {integration: null, isConfigured: false};
    }

    const {data, error} = await supabase
      .from('zotero_integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('Error loading Zotero integration:', error);
      return {integration: null, isConfigured: false};
    }

    return {integration: data as ZoteroIntegration | null, isConfigured: !!data};
  }, 'zoteroImportService.loadZoteroIntegration');
}

/**
 * Save Zotero credentials via the API, then reload the integration.
 * Returns ErrorResult so the caller has no try/catch.
 */
export function saveZoteroCredentials(
  credentials: ZoteroCredentialsInput,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await zoteroService.saveCredentials(credentials);
  }, 'zoteroImportService.saveZoteroCredentials');
}

/**
 * Test the stored Zotero connection.
 * Returns ErrorResult wrapping ZoteroTestConnectionResult so the hook has no
 * try/catch. Connection-level failures (API returns success:false) are
 * surfaced in the result value, not as errors.
 */
export function testZoteroConnection(): Promise<ErrorResult<ZoteroTestConnectionResult>> {
  return toResult(async () => {
    return zoteroService.testConnection();
  }, 'zoteroImportService.testZoteroConnection');
}

/**
 * Disconnect the current user from Zotero.
 * Returns ErrorResult so the hook has no try/catch.
 */
export function disconnectZotero(): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await zoteroService.disconnect();
  }, 'zoteroImportService.disconnectZotero');
}

/**
 * Fetch the list of Zotero collections.
 * Returns ErrorResult so the hook has no try/catch.
 */
export function listZoteroCollections(): Promise<ErrorResult<ZoteroCollection[]>> {
  return toResult(async () => {
    return zoteroService.listCollections();
  }, 'zoteroImportService.listZoteroCollections');
}

/**
 * Run a full Zotero collection import with progress callbacks.
 * Returns ErrorResult so the hook has no try/catch.
 */
export function importZoteroCollection(
  projectId: string,
  collectionKey: string,
  options: ImportOptions,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ErrorResult<ImportResult>> {
  return toResult(async () => {
    return zoteroService.importFromCollection(projectId, collectionKey, options, onProgress);
  }, 'zoteroImportService.importZoteroCollection');
}

/**
 * Fetch the sync status for one run.
 * Returns ErrorResult so the polling loop in useZoteroSyncStatus has no
 * try/catch/finally.
 */
export function fetchZoteroSyncStatus(
  syncRunId: string,
): Promise<ErrorResult<ZoteroSyncStatus>> {
  return toResult(async () => {
    return zoteroService.getSyncStatus(syncRunId);
  }, 'zoteroImportService.fetchZoteroSyncStatus');
}
