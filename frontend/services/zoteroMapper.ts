/**
 * Utilities to map Zotero API data to application format
 */

import type {ArticleFromZotero, ZoteroCreator, ZoteroItem} from '@/types/zotero';
import {supabase} from '@/integrations/supabase/client';

/**
 * Formats Zotero creators (authors, editors) array to string format
 * Format: "LastName, FirstName" or "Organization Name"
 */
export function formatZoteroCreators(creators: ZoteroCreator[]): string[] {
  if (!creators || creators.length === 0) return [];

  return creators.map(creator => {
      // If has name (organization), use as-is
    if (creator.name) {
      return creator.name;
    }

      // If has firstName and lastName
    if (creator.lastName) {
      const firstName = creator.firstName || '';
      return firstName ? `${creator.lastName}, ${firstName}` : creator.lastName;
    }

    // Fallback
    return creator.firstName || 'Unknown';
  }).filter(Boolean);
}

/**
 * Extracts year from Zotero date string
 * Accepted formats: "2023", "2023-01-15", "January 2023", etc.
 */
export function extractYear(dateString: string | undefined): number | null {
  if (!dateString) return null;

    // Try to extract 4 consecutive digits (year)
  const yearMatch = dateString.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return parseInt(yearMatch[0]);
  }

  return null;
}

/**
 * Extracts month from Zotero date string
 */
export function extractMonth(dateString: string | undefined): number | null {
  if (!dateString) return null;

    // Month name mapping (English for parsing)
  const months: Record<string, number> = {
      'jan': 1, 'january': 1,
      'feb': 2, 'february': 2,
      'mar': 3, 'march': 3,
      'apr': 4, 'april': 4,
      'may': 5,
      'jun': 6, 'june': 6,
      'jul': 7, 'july': 7,
      'aug': 8, 'august': 8,
      'sep': 9, 'september': 9,
      'oct': 10, 'october': 10,
      'nov': 11, 'november': 11,
      'dec': 12, 'december': 12,
  };

    // Try ISO format (2023-01-15)
  const isoMatch = dateString.match(/\d{4}-(\d{2})-\d{2}/);
  if (isoMatch) {
    return parseInt(isoMatch[1]);
  }

    // Try month name
  const lowerDate = dateString.toLowerCase();
  for (const [monthName, monthNum] of Object.entries(months)) {
    if (lowerDate.includes(monthName)) {
      return monthNum;
    }
  }

  return null;
}

/**
 * Maps Zotero item to application article format
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
 * Checks if article should be updated by comparing versions
 */
export function shouldUpdateArticle(
  existingVersion: number | null,
  incomingVersion: number
): boolean {
  if (existingVersion === null) return true;
  return incomingVersion > existingVersion;
}

/**
 * Finds duplicate article in project by DOI or title
 * Returns existing article or null if not found
 */
export async function findDuplicateArticle(
  projectId: string,
  item: ZoteroItem
): Promise<{ id: string; zotero_version: number | null } | null> {
  const data = item.data;

    // Debug log: which project_id is being used
    console.log('[findDuplicateArticle] Checking duplicates:', {
    projectId,
    itemKey: item.key,
    doi: data.DOI,
    title: data.title?.substring(0, 50) + '...',
  });

    // Priority 1: Search by zotero_item_key (if already imported)
  if (item.key) {
    const { data: byZoteroKey } = await supabase
      .from('articles')
      .select('id, zotero_version, project_id')
      .eq('project_id', projectId)
      .eq('zotero_item_key', item.key)
      .maybeSingle();

    if (byZoteroKey) {
        console.log('[findDuplicateArticle] Duplicate found by zotero_item_key:', byZoteroKey);
      return byZoteroKey;
    }
  }

    // Priority 2: Search by DOI
  if (data.DOI) {
    const { data: byDoi, error: doiError } = await supabase
      .from('articles')
      .select('id, zotero_version, project_id, zotero_item_key, doi')
      .eq('project_id', projectId)
      .eq('doi', data.DOI)
      .maybeSingle();

      console.log('[findDuplicateArticle] DOI search result:', {
      found: !!byDoi,
      error: doiError,
      result: byDoi,
      searchedDOI: data.DOI,
      searchedProjectId: projectId,
    });

    if (byDoi) {
        console.log('[findDuplicateArticle] Duplicate found by DOI:', byDoi);
      return byDoi;
    }
  }

    // Priority 3: Search by exact title (fallback)
  if (data.title) {
    const { data: byTitle } = await supabase
      .from('articles')
      .select('id, zotero_version, project_id')
      .eq('project_id', projectId)
      .eq('title', data.title)
      .maybeSingle();

    if (byTitle) {
        console.log('[findDuplicateArticle] Duplicate found by title:', byTitle);
      return byTitle;
    }
  }

    console.log('[findDuplicateArticle] No duplicate found');
  return null;
}

/**
 * Normalizes Zotero attachment file type
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
 * Checks if attachment is a valid PDF for download
 */
export function isValidPdfAttachment(attachment: any): boolean {
  if (attachment.data.itemType !== 'attachment') return false;

    // Only accept imported files (not links)
  if (!['imported_file', 'imported_url'].includes(attachment.data.linkMode)) {
    return false;
  }

    // Check if PDF
  const contentType = attachment.data.contentType || '';
  if (!contentType.toLowerCase().includes('pdf')) {
    return false;
  }
  
  return true;
}

/**
 * Checks if attachment should be downloaded based on options
 */
export function shouldDownloadAttachment(
  attachment: any,
  onlyPdfs: boolean
): boolean {
  if (attachment.data.itemType !== 'attachment') return false;

    // Only download imported files (not external links)
  if (!['imported_file', 'imported_url'].includes(attachment.data.linkMode)) {
    return false;
  }
  
  const contentType = (attachment.data.contentType || '').toLowerCase();

    // If "PDFs only" option is on, skip non-PDFs
  if (onlyPdfs && !contentType.includes('pdf')) {
    return false;
  }

    // Accept PDFs and HTMLs (snapshots)
  return contentType.includes('pdf') || contentType.includes('html');
}

/**
 * Prioritizes attachments to identify which should be MAIN file
 * Uses heuristics based on title and metadata
 */
export function prioritizeMainPdf(attachments: any[]): any[] {
  return [...attachments].sort((a, b) => {
    const aTitle = (a.data.title || '').toLowerCase();
    const bTitle = (b.data.title || '').toLowerCase();

      // Keywords that indicate main file
    const mainKeywords = /main|article|manuscript|full.*text|full.*pdf|published|final/i;
    const suppKeywords = /supplement|supporting|appendix|additional/i;
    
    const aIsMain = mainKeywords.test(aTitle);
    const bIsMain = mainKeywords.test(bTitle);
    const aIsSupp = suppKeywords.test(aTitle);
    const bIsSupp = suppKeywords.test(bTitle);

      // Priority 1: File explicitly marked as main
    if (aIsMain && !bIsMain) return -1;
    if (!aIsMain && bIsMain) return 1;

      // Priority 2: Avoid explicitly supplementary files
    if (!aIsSupp && bIsSupp) return -1;
    if (aIsSupp && !bIsSupp) return 1;

      // Priority 3: Prefer PDFs over other formats
    const aIsPdf = (a.data.contentType || '').toLowerCase().includes('pdf');
    const bIsPdf = (b.data.contentType || '').toLowerCase().includes('pdf');
    
    if (aIsPdf && !bIsPdf) return -1;
    if (!aIsPdf && bIsPdf) return 1;

      // Priority 4: Keep original Zotero order
    return 0;
  });
}

/**
 * Determines the appropriate file_role for an attachment
 */
export function determineFileRole(
  attachment: any,
  index: number,
  hasMainFile: boolean
): 'MAIN' | 'SUPPLEMENT' {
    // If MAIN already exists, all others are SUPPLEMENT
  if (hasMainFile) {
    return 'SUPPLEMENT';
  }

    // First attachment is MAIN
  if (index === 0) {
    return 'MAIN';
  }

    // Rest are SUPPLEMENT
  return 'SUPPLEMENT';
}

