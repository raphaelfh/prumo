/**
 * Serviço de Importação do Zotero
 * Gerencia todo o processo de importação de artigos do Zotero para o projeto
 */

import { supabase } from '@/integrations/supabase/client';
import { callEdgeFunction } from '@/lib/supabase/baseRepository';
import type {
  ZoteroCredentialsInput,
  ZoteroTestConnectionResult,
  ZoteroCollection,
  ZoteroItem,
  ImportOptions,
  ImportProgress,
  ImportResult,
  ImportError,
} from '@/types/zotero';
import {
  mapZoteroItemToArticle,
  findDuplicateArticle,
  shouldUpdateArticle,
  shouldDownloadAttachment,
  prioritizeMainPdf,
  determineFileRole,
  normalizeContentType,
} from './zoteroMapper';

// URL da Edge Function
const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zotero-import`;

/**
 * Classe principal para gerenciar importação do Zotero
 */
export class ZoteroImportService {
  private abortController: AbortController | null = null;

  /**
   * Faz chamada à Edge Function do Zotero usando baseRepository
   */
  private async callEdgeFunction<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    // Usar callEdgeFunction do baseRepository
    // O nome da função é 'zotero-import' (extraído da constante EDGE_FUNCTION_URL)
    return await callEdgeFunction<T>(
      'zotero-import',
      { action, ...payload },
      {
        signal: this.abortController?.signal,
      }
    );
  }

  /**
   * Salva credenciais do Zotero no Vault
   */
  async saveCredentials(credentials: ZoteroCredentialsInput): Promise<void> {
    await this.callEdgeFunction('save-credentials', credentials);
  }

  /**
   * Testa conexão com o Zotero usando credenciais armazenadas
   */
  async testConnection(): Promise<ZoteroTestConnectionResult> {
    try {
      const result = await this.callEdgeFunction('test-connection');
      return {
        success: result.success,
        userName: result.userName,
        error: result.error,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Lista collections disponíveis na biblioteca do Zotero
   */
  async listCollections(): Promise<ZoteroCollection[]> {
    const result = await this.callEdgeFunction('list-collections');
    return result.collections || [];
  }

  /**
   * Busca items de uma collection específica
   */
  private async fetchItems(collectionKey: string, limit = 100, start = 0): Promise<{
    items: ZoteroItem[];
    totalResults: number;
    hasMore: boolean;
  }> {
    const result = await this.callEdgeFunction('fetch-items', {
      collectionKey,
      limit,
      start,
    });

    return {
      items: result.items || [],
      totalResults: result.totalResults || 0,
      hasMore: result.hasMore || false,
    };
  }

  /**
   * Busca attachments de um item
   */
  private async fetchAttachments(itemKey: string): Promise<any[]> {
    const result = await this.callEdgeFunction('fetch-attachments', { itemKey });
    return result.attachments || [];
  }

  /**
   * Baixa PDF do Zotero e faz upload para Supabase Storage
   */
  private async downloadAndUploadPdf(
    projectId: string,
    articleId: string,
    attachment: any,
    fileRole: 'MAIN' | 'SUPPLEMENT'
  ): Promise<void> {
    try {
      // 1. Baixar attachment via Edge Function
      const downloadResult = await this.callEdgeFunction('download-attachment', {
        attachmentKey: attachment.key,
      });

      const { base64, filename, contentType, size } = downloadResult;

      // 2. Converter base64 para Blob
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: contentType });

      // 3. Gerar storage key
      const fileExt = filename.split('.').pop() || 'pdf';
      const storageKey = `${projectId}/${articleId}/${Date.now()}_${attachment.key}.${fileExt}`;

      // 4. Upload para Supabase Storage
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

      // 5. Detectar formato do arquivo
      const detectedFormat = this.detectFormatFromContentType(contentType);

      // 6. Criar registro em article_files
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
        // Rollback: deletar arquivo do storage
        await supabase.storage.from('articles').remove([storageKey]);
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      console.log(`PDF uploaded successfully: ${filename} (${fileRole})`);
    } catch (error: any) {
      // Log warning mas não falhar a importação do artigo
      console.warn(`Failed to download PDF ${attachment.data.title}:`, error.message);
      throw error; // Re-throw para tracking no caller
    }
  }

  /**
   * Detecta formato do arquivo a partir do Content-Type
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
   * Processa um único item do Zotero
   */
  private async processItem(
    projectId: string,
    item: ZoteroItem,
    collectionKey: string,
    options: ImportOptions
  ): Promise<{ action: 'imported' | 'updated' | 'skipped'; articleId?: string; error?: string }> {
    try {
      // Log para debug
      console.log('[processItem] Processando item:', {
        projectId,
        itemTitle: item.data.title?.substring(0, 50),
        doi: item.data.DOI,
      });

      // Verificar se item tem título
      if (!item.data.title) {
        return { action: 'skipped', error: 'Item sem título' };
      }

      // Buscar duplicata
      const existing = await findDuplicateArticle(projectId, item);

      // Mapear dados do Zotero para formato do artigo
      const articleData = mapZoteroItemToArticle(item, projectId, collectionKey);

      let articleId: string;
      let action: 'imported' | 'updated' | 'skipped';

      if (existing) {
        // Artigo já existe
        if (!options.updateExisting) {
          return { action: 'skipped', articleId: existing.id };
        }

        // Verificar se deve atualizar (versão mais nova)
        if (!shouldUpdateArticle(existing.zotero_version, item.version)) {
          return { action: 'skipped', articleId: existing.id };
        }

        // Atualizar artigo existente
        const { error } = await supabase
          .from('articles')
          .update({
            ...articleData,
            project_id: projectId, // Garantir que não muda de projeto
          })
          .eq('id', existing.id);

        if (error) throw error;

        articleId = existing.id;
        action = 'updated';
      } else {
        // Criar novo artigo
        console.log('[processItem] Tentando inserir novo artigo:', {
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
          console.error('[processItem] Erro ao inserir artigo:', {
            error,
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          throw error;
        }
        if (!newArticle) throw new Error('Falha ao criar artigo');

        articleId = newArticle.id;
        action = 'imported';
      }

      // Download de PDFs/attachments se configurado
      if (options.downloadPdfs) {
        try {
          const attachments = await this.fetchAttachments(item.key);
          
          // Filtrar attachments válidos
          const downloadableAttachments = attachments.filter(att => 
            shouldDownloadAttachment(att, options.onlyPdfs)
          );

          if (downloadableAttachments.length > 0) {
            // Verificar se artigo já tem arquivo MAIN
            const { data: existingFiles } = await supabase
              .from('article_files')
              .select('file_role')
              .eq('article_id', articleId)
              .eq('file_role', 'MAIN')
              .maybeSingle();

            const hasMainFile = !!existingFiles;

            // Priorizar attachments (primeiro = MAIN)
            const prioritized = prioritizeMainPdf(downloadableAttachments);

            // Download de cada attachment
            for (let i = 0; i < prioritized.length; i++) {
              const attachment = prioritized[i];
              const fileRole = determineFileRole(attachment, i, hasMainFile);

              try {
                await this.downloadAndUploadPdf(projectId, articleId, attachment, fileRole);
              } catch (pdfError: any) {
                console.warn(`Falha ao baixar ${attachment.data.title}:`, pdfError.message);
                // Continuar para próximo arquivo
              }
            }
          }
        } catch (pdfError) {
          console.warn('Erro ao processar attachments:', pdfError);
          // Não falhar a importação do artigo se attachments falharem
        }
      }

      return { action, articleId };

    } catch (error: any) {
      return { 
        action: 'skipped', 
        error: error.message || 'Erro desconhecido' 
      };
    }
  }

  /**
   * Importa artigos de uma collection do Zotero
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
      // Fase 1: Buscar items
      onProgress?.({
        phase: 'fetching',
        current: 0,
        total: 0,
        message: 'Buscando artigos do Zotero...',
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
          message: `Buscando artigos... ${allItems.length}/${totalResults}`,
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

      // Fase 2: Processar items
      onProgress?.({
        phase: 'processing',
        current: 0,
        total: totalItems,
        message: 'Processando artigos...',
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
                itemTitle: item.data.title || 'Sem título',
                error: result.error,
                phase: 'processing',
              });
            }
          }

          // Contar PDFs baixados se opção estiver ativa
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
              // Ignorar erro de contagem
            }
          }
        } catch (error: any) {
          stats.errors++;
          errors.push({
            itemKey: item.key,
            itemTitle: item.data.title || 'Sem título',
            error: error.message || 'Erro desconhecido',
            phase: 'processing',
          });
        }

        const phase = options.downloadPdfs ? 'downloading' : 'processing';
        
        onProgress?.({
          phase,
          current: i + 1,
          total: totalItems,
          message: options.downloadPdfs 
            ? `Processando e baixando PDFs... ${i + 1}/${totalItems}`
            : `Processando ${i + 1}/${totalItems}...`,
          currentFile: item.data.title,
          stats,
        });
      }

      // Fase 3: Completo
      onProgress?.({
        phase: 'complete',
        current: totalItems,
        total: totalItems,
        message: 'Importação concluída!',
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
        message: error.message || 'Erro na importação',
        stats,
      });

      return {
        success: false,
        stats,
        errors: [
          ...errors,
          {
            itemKey: '',
            itemTitle: 'Erro geral',
            error: error.message || 'Erro desconhecido',
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
   * Cancela importação em andamento
   */
  cancelImport(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Remove credenciais do Zotero
   */
  async disconnect(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('Usuário não autenticado');
    }

    // Desativar integração
    const { error } = await supabase
      .from('zotero_integrations')
      .update({ is_active: false })
      .eq('user_id', user.id);

    if (error) {
      throw new Error(`Erro ao desconectar: ${error.message}`);
    }
  }
}

// Exportar instância singleton
export const zoteroService = new ZoteroImportService();

