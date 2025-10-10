/**
 * pdfSearchService - Serviço de busca em documentos PDF
 * 
 * Funcionalidades:
 * - Extração de texto de páginas PDF usando PDF.js
 * - Busca com suporte a case sensitive, palavras inteiras e regex
 * - Cache de texto extraído para performance
 * - Extração de contexto ao redor dos matches
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWords?: boolean;
  useRegex?: boolean;
}

export interface SearchMatch {
  start: number;
  end: number;
  text: string;
}

export interface SearchResult {
  pageNumber: number;
  matches: SearchMatch[];
  text: string;
  context: string;
}

// Cache de texto extraído (página -> texto)
const textCache = new Map<string, string>();
const MAX_CACHE_SIZE = 20; // Limitar cache a 20 páginas

/**
 * Gera chave única para cache baseada no documento e página
 */
function getCacheKey(doc: PDFDocumentProxy, pageNumber: number): string {
  // Usar fingerprint do PDF + número da página
  const fingerprint = (doc as any).fingerprint || doc.loadingTask?.docId || 'unknown';
  return `${fingerprint}-${pageNumber}`;
}

/**
 * Limpa cache se exceder tamanho máximo (FIFO)
 */
function trimCache() {
  if (textCache.size > MAX_CACHE_SIZE) {
    const firstKey = textCache.keys().next().value;
    if (firstKey) {
      textCache.delete(firstKey);
    }
  }
}

/**
 * Extrai texto de uma página PDF
 */
export async function extractTextFromPage(page: PDFPageProxy): Promise<string> {
  try {
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    return text;
  } catch (error) {
    console.error('❌ Erro ao extrair texto da página:', error);
    return '';
  }
}

/**
 * Busca matches de um query em um texto
 */
export function searchInText(
  text: string,
  query: string,
  options: SearchOptions = {}
): SearchMatch[] {
  const { caseSensitive = false, wholeWords = false, useRegex = false } = options;
  const matches: SearchMatch[] = [];

  if (!query.trim()) return matches;

  try {
    let pattern: RegExp;

    if (useRegex) {
      // Modo regex: usar query diretamente
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } else {
      // Escape caracteres especiais de regex
      let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Adicionar word boundaries se wholeWords ativo
      if (wholeWords) {
        escapedQuery = `\\b${escapedQuery}\\b`;
      }
      
      pattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
    }

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
      
      // Evitar loop infinito com matches de comprimento zero
      if (match[0].length === 0) {
        pattern.lastIndex++;
      }
    }
  } catch (error) {
    console.error('❌ Erro ao buscar no texto (regex inválida?):', error);
  }

  return matches;
}

/**
 * Extrai contexto ao redor de um match
 */
function extractContext(text: string, match: SearchMatch, contextLength = 50): string {
  const start = Math.max(0, match.start - contextLength);
  const end = Math.min(text.length, match.end + contextLength);
  
  let context = text.substring(start, end);
  
  // Adicionar reticências se truncado
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';
  
  return context;
}

/**
 * Busca em todo o documento PDF
 */
export async function searchInDocument(
  doc: PDFDocumentProxy,
  query: string,
  options: SearchOptions = {},
  onProgress?: (current: number, total: number) => void
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  if (!query.trim()) return results;

  const numPages = doc.numPages;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      // Verificar cache primeiro
      const cacheKey = getCacheKey(doc, pageNum);
      let pageText: string;

      if (textCache.has(cacheKey)) {
        pageText = textCache.get(cacheKey)!;
      } else {
        // Extrair texto da página
        const page = await doc.getPage(pageNum);
        pageText = await extractTextFromPage(page);
        
        // Salvar no cache
        textCache.set(cacheKey, pageText);
        trimCache();
      }

      // Buscar matches na página
      const matches = searchInText(pageText, query, options);

      if (matches.length > 0) {
        // Pegar contexto do primeiro match (para preview)
        const context = extractContext(pageText, matches[0]);
        
        results.push({
          pageNumber: pageNum,
          matches,
          text: pageText,
          context,
        });
      }

      // Notificar progresso
      if (onProgress) {
        onProgress(pageNum, numPages);
      }
    } catch (error) {
      console.error(`❌ Erro ao buscar na página ${pageNum}:`, error);
    }
  }

  return results;
}

/**
 * Limpa cache de texto (útil ao trocar de documento)
 */
export function clearTextCache() {
  textCache.clear();
}

