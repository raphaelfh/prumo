/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Tipos TypeScript para Articles
 * 
 * Baseado nos tipos gerados do Supabase para garantir consistência
 * e type safety em toda a aplicação.
 */

import type { Database } from '@/integrations/supabase/types';

/**
 * Tipo base de Article do banco de dados
 * Usa o tipo gerado do Supabase para garantir type safety
 */
export type Article = Database['public']['Tables']['articles']['Row'];

/**
 * Tipo para inserção de Article
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
  created_at: string;
  updated_at: string;
}

/**
 * Helper para criar ArticleListItem a partir de Article
 */
export function toArticleListItem(article: Article): ArticleListItem {
  return {
    id: article.id,
    title: article.title,
    authors: article.authors,
    publication_year: article.publication_year,
    journal_title: article.journal_title,
    doi: article.doi,
    created_at: article.created_at,
    updated_at: article.updated_at,
  };
}

