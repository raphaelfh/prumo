/**
 * Utilitários para mapear dados da API do Zotero para formato da aplicação
 */

import type { ZoteroItem, ZoteroCreator, ArticleFromZotero } from '@/types/zotero';
import { supabase } from '@/integrations/supabase/client';

/**
 * Formata array de criadores (autores, editores) do Zotero para formato de string
 * Formato: "Sobrenome, Nome" ou "Nome da Organização"
 */
export function formatZoteroCreators(creators: ZoteroCreator[]): string[] {
  if (!creators || creators.length === 0) return [];

  return creators.map(creator => {
    // Se tem name (organização), usar direto
    if (creator.name) {
      return creator.name;
    }

    // Se tem firstName e lastName
    if (creator.lastName) {
      const firstName = creator.firstName || '';
      return firstName ? `${creator.lastName}, ${firstName}` : creator.lastName;
    }

    // Fallback
    return creator.firstName || 'Unknown';
  }).filter(Boolean);
}

/**
 * Extrai ano de string de data do Zotero
 * Formatos aceitos: "2023", "2023-01-15", "January 2023", etc.
 */
export function extractYear(dateString: string | undefined): number | null {
  if (!dateString) return null;

  // Tentar extrair 4 dígitos seguidos (ano)
  const yearMatch = dateString.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return parseInt(yearMatch[0]);
  }

  return null;
}

/**
 * Extrai mês de string de data do Zotero
 */
export function extractMonth(dateString: string | undefined): number | null {
  if (!dateString) return null;

  // Mapeamento de nomes de meses
  const months: Record<string, number> = {
    'jan': 1, 'january': 1, 'janeiro': 1,
    'feb': 2, 'february': 2, 'fevereiro': 2,
    'mar': 3, 'march': 3, 'março': 3,
    'apr': 4, 'april': 4, 'abril': 4,
    'may': 5, 'maio': 5,
    'jun': 6, 'june': 6, 'junho': 6,
    'jul': 7, 'july': 7, 'julho': 7,
    'aug': 8, 'august': 8, 'agosto': 8,
    'sep': 9, 'september': 9, 'setembro': 9,
    'oct': 10, 'october': 10, 'outubro': 10,
    'nov': 11, 'november': 11, 'novembro': 11,
    'dec': 12, 'december': 12, 'dezembro': 12,
  };

  // Tentar formato ISO (2023-01-15)
  const isoMatch = dateString.match(/\d{4}-(\d{2})-\d{2}/);
  if (isoMatch) {
    return parseInt(isoMatch[1]);
  }

  // Tentar nome do mês
  const lowerDate = dateString.toLowerCase();
  for (const [monthName, monthNum] of Object.entries(months)) {
    if (lowerDate.includes(monthName)) {
      return monthNum;
    }
  }

  return null;
}

/**
 * Mapeia item do Zotero para formato de artigo da aplicação
 */
export function mapZoteroItemToArticle(
  item: ZoteroItem,
  projectId: string,
  collectionKey: string | null
): ArticleFromZotero {
  const data = item.data;

  return {
    title: data.title || 'Untitled',
    abstract: data.abstractNote || null,
    authors: formatZoteroCreators(data.creators || []),
    publication_year: extractYear(data.date),
    publication_month: extractMonth(data.date),
    journal_title: data.publicationTitle || null,
    journal_issn: data.ISSN || null,
    volume: data.volume || null,
    issue: data.issue || null,
    pages: data.pages || null,
    doi: data.DOI || null,
    url_landing: data.url || null,
    keywords: data.tags?.map(t => t.tag) || null,
    article_type: data.itemType || null,
    language: data.language || null,
    zotero_item_key: item.key,
    zotero_collection_key: collectionKey,
    zotero_version: item.version,
    ingestion_source: 'ZOTERO',
    source_payload: {
      zotero_data: data,
      zotero_meta: item.meta || {},
    },
  };
}

/**
 * Verifica se artigo deve ser atualizado comparando versões
 */
export function shouldUpdateArticle(
  existingVersion: number | null,
  incomingVersion: number
): boolean {
  if (existingVersion === null) return true;
  return incomingVersion > existingVersion;
}

/**
 * Busca artigo duplicado no projeto por DOI ou PMID
 * Retorna o artigo existente ou null se não encontrar
 */
export async function findDuplicateArticle(
  projectId: string,
  item: ZoteroItem
): Promise<{ id: string; zotero_version: number | null } | null> {
  const data = item.data;

  // Log para debug: verificar qual project_id está sendo usado
  console.log('[findDuplicateArticle] Verificando duplicatas:', {
    projectId,
    itemKey: item.key,
    doi: data.DOI,
    title: data.title?.substring(0, 50) + '...',
  });

  // Prioridade 1: Buscar por zotero_item_key (caso já tenha sido importado)
  if (item.key) {
    const { data: byZoteroKey } = await supabase
      .from('articles')
      .select('id, zotero_version, project_id')
      .eq('project_id', projectId)
      .eq('zotero_item_key', item.key)
      .maybeSingle();

    if (byZoteroKey) {
      console.log('[findDuplicateArticle] Duplicata encontrada por zotero_item_key:', byZoteroKey);
      return byZoteroKey;
    }
  }

  // Prioridade 2: Buscar por DOI
  if (data.DOI) {
    const { data: byDoi, error: doiError } = await supabase
      .from('articles')
      .select('id, zotero_version, project_id, zotero_item_key, doi')
      .eq('project_id', projectId)
      .eq('doi', data.DOI)
      .maybeSingle();

    console.log('[findDuplicateArticle] Resultado da busca por DOI:', {
      found: !!byDoi,
      error: doiError,
      result: byDoi,
      searchedDOI: data.DOI,
      searchedProjectId: projectId,
    });

    if (byDoi) {
      console.log('[findDuplicateArticle] Duplicata encontrada por DOI:', byDoi);
      return byDoi;
    }
  }

  // Prioridade 3: Buscar por título exato (fallback)
  if (data.title) {
    const { data: byTitle } = await supabase
      .from('articles')
      .select('id, zotero_version, project_id')
      .eq('project_id', projectId)
      .eq('title', data.title)
      .maybeSingle();

    if (byTitle) {
      console.log('[findDuplicateArticle] Duplicata encontrada por título:', byTitle);
      return byTitle;
    }
  }

  console.log('[findDuplicateArticle] Nenhuma duplicata encontrada');
  return null;
}

/**
 * Normaliza tipo de arquivo do attachment Zotero
 */
export function normalizeContentType(contentType: string): string {
  const lower = contentType.toLowerCase();
  
  if (lower.includes('pdf')) return 'PDF';
  if (lower.includes('html')) return 'HTML';
  if (lower.includes('xml')) return 'XML';
  if (lower.includes('doc')) return 'DOC';
  if (lower.includes('docx')) return 'DOCX';
  
  return 'OTHER';
}

/**
 * Verifica se attachment é um PDF válido para download
 */
export function isValidPdfAttachment(attachment: any): boolean {
  if (attachment.data.itemType !== 'attachment') return false;
  
  // Só aceitar arquivos importados (não links)
  if (!['imported_file', 'imported_url'].includes(attachment.data.linkMode)) {
    return false;
  }
  
  // Verificar se é PDF
  const contentType = attachment.data.contentType || '';
  if (!contentType.toLowerCase().includes('pdf')) {
    return false;
  }
  
  return true;
}

/**
 * Verifica se attachment deve ser baixado baseado nas opções
 */
export function shouldDownloadAttachment(
  attachment: any,
  onlyPdfs: boolean
): boolean {
  if (attachment.data.itemType !== 'attachment') return false;
  
  // Só baixar imported files (não links externos)
  if (!['imported_file', 'imported_url'].includes(attachment.data.linkMode)) {
    return false;
  }
  
  const contentType = (attachment.data.contentType || '').toLowerCase();
  
  // Se opção "apenas PDFs" está ativa, skip não-PDFs
  if (onlyPdfs && !contentType.includes('pdf')) {
    return false;
  }
  
  // Aceitar PDFs e HTMLs (snapshots)
  return contentType.includes('pdf') || contentType.includes('html');
}

/**
 * Prioriza attachments para identificar qual deve ser o arquivo MAIN
 * Usa heurísticas baseadas no título e metadata
 */
export function prioritizeMainPdf(attachments: any[]): any[] {
  return [...attachments].sort((a, b) => {
    const aTitle = (a.data.title || '').toLowerCase();
    const bTitle = (b.data.title || '').toLowerCase();
    
    // Palavras-chave que indicam arquivo principal
    const mainKeywords = /main|article|manuscript|full.*text|full.*pdf|published|final/i;
    const suppKeywords = /supplement|supporting|appendix|additional/i;
    
    const aIsMain = mainKeywords.test(aTitle);
    const bIsMain = mainKeywords.test(bTitle);
    const aIsSupp = suppKeywords.test(aTitle);
    const bIsSupp = suppKeywords.test(bTitle);
    
    // Prioridade 1: Arquivo explicitamente marcado como main
    if (aIsMain && !bIsMain) return -1;
    if (!aIsMain && bIsMain) return 1;
    
    // Prioridade 2: Evitar arquivos explicitamente suplementares
    if (!aIsSupp && bIsSupp) return -1;
    if (aIsSupp && !bIsSupp) return 1;
    
    // Prioridade 3: Preferir PDFs sobre outros formatos
    const aIsPdf = (a.data.contentType || '').toLowerCase().includes('pdf');
    const bIsPdf = (b.data.contentType || '').toLowerCase().includes('pdf');
    
    if (aIsPdf && !bIsPdf) return -1;
    if (!aIsPdf && bIsPdf) return 1;
    
    // Prioridade 4: Manter ordem original do Zotero
    return 0;
  });
}

/**
 * Determina o file_role apropriado para um attachment
 */
export function determineFileRole(
  attachment: any,
  index: number,
  hasMainFile: boolean
): 'MAIN' | 'SUPPLEMENT' {
  // Se já existe MAIN, todos são SUPPLEMENT
  if (hasMainFile) {
    return 'SUPPLEMENT';
  }
  
  // Primeiro attachment vai como MAIN
  if (index === 0) {
    return 'MAIN';
  }
  
  // Demais vão como SUPPLEMENT
  return 'SUPPLEMENT';
}

