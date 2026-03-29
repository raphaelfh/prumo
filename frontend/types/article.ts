/**
 * Tipos TypeScript para Articles
 *
 * Based on Supabase generated types for consistency
 * e type safety em toda a aplicação.
 */

import type {Database} from '@/integrations/supabase/types';

/**
 * Tipo base de Article do banco de dados
 * Usa o tipo gerado do Supabase para garantir type safety
 */
export type Article = Database['public']['Tables']['articles']['Row'];
export type ArticleSyncState = 'active' | 'removed_at_source' | 'conflict';

/**
 * Type for Article insert
 */
export type ArticleInsert = Database['public']['Tables']['articles']['Insert'];

/**
 * Tipo para atualização de Article
 */
export type ArticleUpdate = Partial<Omit<Article, 'id' | 'created_at'>>;

/**
 * Tipo simplificado de Article para uso em listas
 * Contém apenas campos essenciais para exibição
 */
export interface ArticleListItem {
  id: string;
  title: string;
  authors: string[] | null;
  publication_year: number | null;
  journal_title: string | null;
  doi: string | null;
    ingestion_source: string | null;
    zotero_item_key: string | null;
    sync_state: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Helper to create ArticleListItem from Article
 */
export function toArticleListItem(article: Article): ArticleListItem {
  return {
    id: article.id,
    title: article.title,
    authors: article.authors,
    publication_year: article.publication_year,
    journal_title: article.journal_title,
    doi: article.doi,
      ingestion_source: article.ingestion_source,
      zotero_item_key: article.zotero_item_key,
      sync_state: article.sync_state,
    created_at: article.created_at,
    updated_at: article.updated_at,
  };
}

