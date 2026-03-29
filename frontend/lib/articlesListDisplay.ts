/**
 * Column labels and cell formatting for the articles data table (full metadata).
 */
import type {Article} from '@/types/article';
import {t} from '@/lib/copy';
import {formatZoteroItemTypeForDisplay} from '@/lib/zoteroItemTypes';

/** Columns after core UI columns (title, PDF, source, authors, journal, year, keywords, DOI, abstract). */
export const ARTICLES_DATA_COLUMN_DEFS: { id: string; label: string }[] = [
    {id: 'publication_month', label: 'Pub. month'},
    {id: 'publication_day', label: 'Pub. day'},
    {id: 'journal_issn', label: 'ISSN'},
    {id: 'journal_eissn', label: 'eISSN'},
    {id: 'journal_publisher', label: 'Publisher'},
    {id: 'volume', label: 'Volume'},
    {id: 'issue', label: 'Issue'},
    {id: 'pages', label: 'Pages'},
    {id: 'pmcid', label: 'PMCID'},
    {id: 'arxiv_id', label: 'arXiv'},
    {id: 'pii', label: 'PII'},
    {id: 'mesh_terms', label: 'MeSH'},
    {id: 'url_landing', label: 'URL'},
    {id: 'url_pdf', label: 'PDF URL'},
    {id: 'language', label: 'Language'},
    {id: 'article_type', label: 'Item type'},
    {id: 'publication_status', label: 'Pub. status'},
    {id: 'open_access', label: 'Open access'},
    {id: 'license', label: 'License'},
    {id: 'study_design', label: 'Study design'},
    {id: 'conflicts_of_interest', label: 'COI'},
    {id: 'data_availability', label: 'Data avail.'},
    {id: 'registration', label: 'Registration'},
    {id: 'funding', label: 'Funding'},
    {id: 'source_payload', label: 'Source payload'},
    {id: 'sync_conflict_log', label: 'Sync conflict'},
    {id: 'hash_fingerprint', label: 'Fingerprint'},
    {id: 'source_lineage', label: 'Lineage'},
    {id: 'row_version', label: 'Row ver.'},
    {id: 'zotero_item_key', label: 'Zotero item'},
    {id: 'zotero_collection_key', label: 'Zotero coll.'},
    {id: 'zotero_version', label: 'Zotero ver.'},
    {id: 'removed_at_source_at', label: 'Removed src.'},
    {id: 'last_synced_at', label: 'Last sync'},
    {id: 'created_at', label: 'Created'},
    {id: 'updated_at', label: 'Updated'},
    {id: 'pdf_extracted_text', label: 'PDF text'},
    {id: 'semantic_abstract_text', label: 'Sem. abstract'},
    {id: 'semantic_fulltext_text', label: 'Sem. fulltext'},
];

const BLOB_COLUMN_IDS = new Set([
    'pdf_extracted_text',
    'semantic_abstract_text',
    'semantic_fulltext_text',
]);

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + '\u2026';
}

function jsonPreview(v: unknown): string {
    if (v == null) return '\u2013';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return truncate(s, 80);
}

/** Plain-text cell value for table (tooltip / title can wrap). */
export function formatArticleListCell(article: Article, columnId: string): string {
    if (BLOB_COLUMN_IDS.has(columnId)) {
        const raw = article[columnId as keyof Article];
        if (raw == null || raw === '') return '\u2013';
        if (typeof raw === 'string' && raw.length > 0) return truncate(raw, 64);
        return '\u2026';
    }

    switch (columnId) {
        case 'publication_month':
            return article.publication_month != null ? String(article.publication_month) : '\u2013';
        case 'publication_day':
            return article.publication_day != null ? String(article.publication_day) : '\u2013';
        case 'journal_issn':
        case 'journal_eissn':
        case 'journal_publisher':
        case 'volume':
        case 'issue':
        case 'pages':
        case 'pmcid':
        case 'arxiv_id':
        case 'pii':
        case 'url_landing':
        case 'url_pdf':
        case 'language':
        case 'publication_status':
        case 'license':
        case 'study_design':
        case 'hash_fingerprint':
        case 'source_lineage':
        case 'zotero_item_key':
        case 'zotero_collection_key': {
            const v = article[columnId as keyof Article];
            if (v == null || v === '') return '\u2013';
            return truncate(String(v), 120);
        }
        case 'article_type':
            return truncate(formatZoteroItemTypeForDisplay(article.article_type), 120);
        case 'mesh_terms': {
            const m = article.mesh_terms;
            if (!m?.length) return '\u2013';
            return truncate(m.filter(Boolean).join(', '), 100);
        }
        case 'open_access':
            if (article.open_access === true) return 'Yes';
            if (article.open_access === false) return 'No';
            return '\u2013';
        case 'conflicts_of_interest':
        case 'data_availability': {
            const v = article[columnId as keyof Article];
            if (v == null || v === '') return '\u2013';
            return truncate(String(v), 100);
        }
        case 'registration':
            return jsonPreview(article.registration);
        case 'funding':
            return jsonPreview(article.funding);
        case 'source_payload':
            return jsonPreview(article.source_payload);
        case 'sync_conflict_log':
            return jsonPreview(article.sync_conflict_log);
        case 'row_version':
            return article.row_version != null ? String(article.row_version) : '\u2013';
        case 'zotero_version':
            return article.zotero_version != null ? String(article.zotero_version) : '\u2013';
        case 'removed_at_source_at':
        case 'last_synced_at':
        case 'created_at':
        case 'updated_at': {
            const v = article[columnId as keyof Article];
            if (v == null || v === '') return '\u2013';
            try {
                return truncate(new Date(String(v)).toISOString().replace('T', ' ').slice(0, 19), 32);
            } catch {
                return truncate(String(v), 24);
            }
        }
        default:
            return '\u2013';
    }
}

export function articleListCellTitle(article: Article, columnId: string): string | undefined {
    if (BLOB_COLUMN_IDS.has(columnId)) {
        const raw = article[columnId as keyof Article];
        if (raw == null || raw === '')
            return t('articles', 'listSemanticTextNotLoaded');
    }
    return undefined;
}
