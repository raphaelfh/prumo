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

// The list-projection type lives in services/articlesService.ts next to
// fetchProjectArticles, which is what HITLArticleTable consumes. The copy
// that used to sit here described a wider shape no query ever returned.

