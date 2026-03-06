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
    ZoteroItem,
    ZoteroTestConnectionResult,
} from '@/types/zotero';
import {
    determineFileRole,
    findDuplicateArticle,
    mapZoteroItemToArticle,
    prioritizeMainPdf,
    shouldDownloadAttachment,
    shouldUpdateArticle,
} from './zoteroMapper';
import {t} from '@/lib/copy';

/**
 * Main class for managing Zotero import
 */
export class ZoteroImportService {
  private abortController: AbortController | null = null;

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
   * Fetches items from a specific collection
   */
  private async fetchItems(collectionKey: string, limit = 100, start = 0): Promise<{
    items: ZoteroItem[];
    totalResults: number;
    hasMore: boolean;
  }> {
    const result = await this.callZoteroApi<{
      items: ZoteroItem[];
      total_results?: number;
      totalResults?: number;
      has_more?: boolean;
      hasMore?: boolean;
    }>('fetch-items', {
      collectionKey,
      limit,
      start,
    });

    return {
      items: result.items || [],
      totalResults: result.total_results || result.totalResults || 0,
      hasMore: result.has_more || result.hasMore || false,
    };
  }

  /**
   * Fetches attachments for an item
   */
  private async fetchAttachments(itemKey: string): Promise<any[]> {
    const result = await this.callZoteroApi<{ attachments: any[] }>('fetch-attachments', { itemKey });
    return result.attachments || [];
  }

  /**
   * Downloads PDF from Zotero and uploads to Supabase Storage
   */
  private async downloadAndUploadPdf(
    projectId: string,
    articleId: string,
    attachment: any,
    fileRole: 'MAIN' | 'SUPPLEMENT'
  ): Promise<void> {
    try {
        // 1. Download attachment via API
      const downloadResult = await this.callZoteroApi<{
        base64: string;
        filename: string;
        content_type?: string;
        contentType?: string;
        size: number;
      }>('download-attachment', {
        attachmentKey: attachment.key,
      });

      const { base64, filename, size } = downloadResult;
      const contentType = downloadResult.content_type || downloadResult.contentType || 'application/pdf';

        // 2. Convert base64 to Blob
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: contentType });

        // 3. Generate storage key
      const fileExt = filename.split('.').pop() || 'pdf';
      const storageKey = `${projectId}/${articleId}/${Date.now()}_${attachment.key}.${fileExt}`;

        // 4. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('articles')
        .upload(storageKey, blob, {
          contentType,
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

        // 5. Detect file format
      const detectedFormat = this.detectFormatFromContentType(contentType);

        // 6. Create record in article_files
      const { error: insertError } = await supabase
        .from('article_files')
        .insert({
          project_id: projectId,
          article_id: articleId,
          file_type: detectedFormat,
          file_role: fileRole,
          storage_key: storageKey,
          original_filename: filename,
          bytes: size,
          md5: attachment.data.md5 || null,
        });

      if (insertError) {
          // Rollback: delete file from storage
        await supabase.storage.from('articles').remove([storageKey]);
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      console.log(`PDF uploaded successfully: ${filename} (${fileRole})`);
    } catch (error: any) {
        // Log warning but do not fail article import
      console.warn(`Failed to download PDF ${attachment.data.title}:`, error.message);
        throw error; // Re-throw for tracking in caller
    }
  }

  /**
   * Detects file format from Content-Type
   */
  private detectFormatFromContentType(contentType: string): string {
    const lower = contentType.toLowerCase();
    
    if (lower.includes('pdf')) return 'PDF';
    if (lower.includes('html')) return 'HTML';
    if (lower.includes('doc')) return 'DOC';
    if (lower.includes('docx')) return 'DOCX';
    
    return 'OTHER';
  }

  /**
   * Processes a single Zotero item
   */
  private async processItem(
    projectId: string,
    item: ZoteroItem,
    collectionKey: string,
    options: ImportOptions
  ): Promise<{ action: 'imported' | 'updated' | 'skipped'; articleId?: string; error?: string }> {
    try {
        // Debug log
        console.log('[processItem] Processing item:', {
        projectId,
        itemTitle: item.data.title?.substring(0, 50),
        doi: item.data.DOI,
      });

        // Check if item has title
      if (!item.data.title) {
          return {action: 'skipped', error: t('extraction', 'zoteroItemNoTitle')};
      }

        // Find duplicate
      const existing = await findDuplicateArticle(projectId, item);

        // Map Zotero data to article format
      const articleData = mapZoteroItemToArticle(item, projectId, collectionKey);

      let articleId: string;
      let action: 'imported' | 'updated' | 'skipped';

      if (existing) {
          // Article already exists
        if (!options.updateExisting) {
          return { action: 'skipped', articleId: existing.id };
        }

          // Check if should update (newer version)
        if (!shouldUpdateArticle(existing.zotero_version, item.version)) {
          return { action: 'skipped', articleId: existing.id };
        }

          // Update existing article
        const { error } = await supabase
          .from('articles')
          .update({
            ...articleData,
              project_id: projectId, // Ensure project does not change
          })
          .eq('id', existing.id);

        if (error) throw error;

        articleId = existing.id;
        action = 'updated';
      } else {
          // Create new article
          console.log('[processItem] Inserting new article:', {
          projectId,
          doi: articleData.doi,
          title: articleData.title?.substring(0, 50),
          zotero_item_key: articleData.zotero_item_key,
        });

        const { data: newArticle, error } = await supabase
          .from('articles')
          .insert({
            ...articleData,
            project_id: projectId,
          })
          .select('id')
          .single();

        if (error) {
            console.error('[processItem] Error inserting article:', {
            error,
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          throw error;
        }
          if (!newArticle) throw new Error('Failed to create article');

        articleId = newArticle.id;
        action = 'imported';
      }

        // Download PDFs/attachments if configured
      if (options.downloadPdfs) {
        try {
          const attachments = await this.fetchAttachments(item.key);

            // Filter valid attachments
          const downloadableAttachments = attachments.filter(att => 
            shouldDownloadAttachment(att, options.onlyPdfs)
          );

          if (downloadableAttachments.length > 0) {
              // Check if article already has MAIN file
            const { data: existingFiles } = await supabase
              .from('article_files')
              .select('file_role')
              .eq('article_id', articleId)
              .eq('file_role', 'MAIN')
              .maybeSingle();

            const hasMainFile = !!existingFiles;

              // Prioritize attachments (first = MAIN)
            const prioritized = prioritizeMainPdf(downloadableAttachments);

              // Download each attachment
            for (let i = 0; i < prioritized.length; i++) {
              const attachment = prioritized[i];
              const fileRole = determineFileRole(attachment, i, hasMainFile);

              try {
                await this.downloadAndUploadPdf(projectId, articleId, attachment, fileRole);
              } catch (pdfError: any) {
                  console.warn(`Failed to download ${attachment.data.title}:`, pdfError.message);
                  // Continue to next file
              }
            }
          }
        } catch (pdfError) {
            console.warn('Error processing attachments:', pdfError);
            // Do not fail article import if attachments fail
        }
      }

      return { action, articleId };

    } catch (error: any) {
      return { 
        action: 'skipped',
          error: error.message || 'Unknown error'
      };
    }
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

    const stats = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      pdfsDownloaded: 0,
    };

    const errors: ImportError[] = [];

    try {
        // Phase 1: Fetch items
      onProgress?.({
        phase: 'fetching',
        current: 0,
        total: 0,
          message: t('extraction', 'zoteroProgressFetching'),
        stats,
      });

      let allItems: ZoteroItem[] = [];
      let start = 0;
      const batchSize = 100;
      let hasMore = true;

      while (hasMore) {
        const { items, totalResults, hasMore: more } = await this.fetchItems(
          collectionKey,
          batchSize,
          start
        );

        allItems = [...allItems, ...items];
        hasMore = more;
        start += batchSize;

        onProgress?.({
          phase: 'fetching',
          current: allItems.length,
          total: totalResults,
            message: t('extraction', 'zoteroProgressFetchingCount').replace('{{current}}', String(allItems.length)).replace('{{total}}', String(totalResults)),
          stats,
        });
      }

      const totalItems = allItems.length;

      if (totalItems === 0) {
        return {
          success: true,
          stats,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

        // Phase 2: Process items
      onProgress?.({
        phase: 'processing',
        current: 0,
        total: totalItems,
          message: t('extraction', 'zoteroProgressProcessing'),
        stats,
      });

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];

        try {
          const result = await this.processItem(projectId, item, collectionKey, options);

          if (result.action === 'imported') {
            stats.imported++;
          } else if (result.action === 'updated') {
            stats.updated++;
          } else if (result.action === 'skipped') {
            stats.skipped++;
            if (result.error) {
              errors.push({
                itemKey: item.key,
                  itemTitle: item.data.title || t('extraction', 'zoteroItemTitleFallback'),
                error: result.error,
                phase: 'processing',
              });
            }
          }

            // Count downloaded PDFs if option is enabled
          if (options.downloadPdfs && result.articleId) {
            try {
              const { count } = await supabase
                .from('article_files')
                .select('id', { count: 'exact', head: true })
                .eq('article_id', result.articleId);
              
              if (count && count > 0) {
                stats.pdfsDownloaded = (stats.pdfsDownloaded || 0) + count;
              }
            } catch (countError) {
                // Ignore count error
            }
          }
        } catch (error: any) {
          stats.errors++;
          errors.push({
            itemKey: item.key,
              itemTitle: item.data.title || t('extraction', 'zoteroItemTitleFallback'),
              error: error.message || 'Unknown error',
            phase: 'processing',
          });
        }

        const phase = options.downloadPdfs ? 'downloading' : 'processing';
        
        onProgress?.({
          phase,
          current: i + 1,
          total: totalItems,
          message: options.downloadPdfs
              ? t('extraction', 'zoteroProgressProcessingWithPdfs').replace('{{current}}', String(i + 1)).replace('{{total}}', String(totalItems))
              : t('extraction', 'zoteroProgressProcessingCount').replace('{{current}}', String(i + 1)).replace('{{total}}', String(totalItems)),
          currentFile: item.data.title,
          stats,
        });
      }

        // Phase 3: Complete
      onProgress?.({
        phase: 'complete',
        current: totalItems,
        total: totalItems,
          message: t('extraction', 'zoteroProgressComplete'),
        stats,
      });

      return {
        success: true,
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
