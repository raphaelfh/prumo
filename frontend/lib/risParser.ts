/**
 * Parser for RIS files, mapping to articles table columns.
 * RIS format: lines "TAG  - value"; records separated by "ER  - ".
 * Ref: https://en.wikipedia.org/wiki/RIS_(file_format)
 */

import {t} from '@/lib/copy';

export interface ParsedRisRecord {
    /** Tag → list of values (repeating tags like AU, KW accumulate) */
    fields: Record<string, string[]>;
}

/** Payload in snake_case for insert into articles (Supabase) */
export interface ArticleInsertPayload {
    project_id: string;
    title: string;
    abstract: string | null;
    language: string | null;
    publication_year: number | null;
    publication_month: number | null;
    publication_day: number | null;
    journal_title: string | null;
    journal_issn: string | null;
    journal_eissn: string | null;
    journal_publisher: string | null;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    article_type: string | null;
    publication_status: string | null;
    open_access: boolean | null;
    license: string | null;
    doi: string | null;
    pmid: string | null;
    pmcid: string | null;
    arxiv_id: string | null;
    pii: string | null;
    keywords: string[] | null;
    authors: string[] | null;
    mesh_terms: string[] | null;
    url_landing: string | null;
    url_pdf: string | null;
    ingestion_source: string;
    source_payload: Record<string, unknown>;
}

const RIS_TAG_REGEX = /^([A-Z0-9]{2})\s{2}-\s(.*)$/;

/**
 * Extrai o primeiro valor de um tag ou null
 */
function first(record: ParsedRisRecord, tag: string): string | null {
    const arr = record.fields[tag];
    if (!arr || arr.length === 0) return null;
    const v = arr[0].trim();
    return v === '' ? null : v;
}

/**
 * Retorna todos os valores de um tag (ex.: AU, KW) como array, sem vazios
 */
function all(record: ParsedRisRecord, tag: string): string[] {
    const arr = record.fields[tag];
    if (!arr) return [];
    return arr.map(s => s.trim()).filter(Boolean);
}

/**
 * Parse year (4 digits between 1600 and 2500)
 */
function parseYear(s: string | null): number | null {
    if (!s) return null;
    const m = s.match(/\b(19|20)\d{2}\b/);
    if (!m) return null;
    const y = parseInt(m[0], 10);
    return y >= 1600 && y <= 2500 ? y : null;
}

/**
 * Parse date to month and day (DA or Y1: DD/MM/YYYY, YYYY/MM/DD, or year only)
 */
function parseDateParts(s: string | null): { month: number | null; day: number | null; year: number | null } {
    if (!s) return {month: null, day: null, year: null};
    const trimmed = s.trim();
    // YYYY/MM/DD ou YYYY-MM-DD
    const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (iso) {
        const month = parseInt(iso[2], 10);
        const day = parseInt(iso[3], 10);
        return {
            year: parseInt(iso[1], 10),
            month: month >= 1 && month <= 12 ? month : null,
            day: day >= 1 && day <= 31 ? day : null,
        };
    }
    // DD/MM/YYYY
    const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) {
        const day = parseInt(dmy[1], 10);
        const month = parseInt(dmy[2], 10);
        return {
            year: parseInt(dmy[3], 10),
            month: month >= 1 && month <= 12 ? month : null,
            day: day >= 1 && day <= 31 ? day : null,
        };
    }
    const y = parseYear(trimmed);
    return {year: y, month: null, day: null};
}

/**
 * Build page string from SP and EP
 */
function buildPages(record: ParsedRisRecord): string | null {
    const sp = first(record, 'SP');
    const ep = first(record, 'EP');
    if (sp && ep) return `${sp}-${ep}`;
    if (sp) return sp;
    if (ep) return ep;
    return null;
}

/**
 * Keywords: multiple KW or single with separators (; or ,)
 */
function buildKeywords(record: ParsedRisRecord): string[] | null {
    const kwList = all(record, 'KW');
    if (kwList.length === 0) return null;
    const expanded: string[] = [];
    for (const kw of kwList) {
        const parts = kw.split(/[;,]/).map(p => p.trim()).filter(Boolean);
        expanded.push(...parts);
    }
    return expanded.length > 0 ? expanded : null;
}

/**
 * URLs: first → url_landing; if more or contains "pdf" → url_pdf
 */
function buildUrls(record: ParsedRisRecord): { url_landing: string | null; url_pdf: string | null } {
    const urls = all(record, 'UR');
    if (urls.length === 0) return {url_landing: null, url_pdf: null};
    const lower = urls.map(u => u.toLowerCase());
    const pdfIndex = lower.findIndex(u => u.includes('pdf') || u.endsWith('.pdf'));
    const urlLanding = urls[0] || null;
    const urlPdf = pdfIndex >= 0 ? urls[pdfIndex] : (urls.length > 1 ? urls[1] : null);
    return {url_landing: urlLanding, url_pdf: urlPdf};
}

/**
 * Parse RIS file content into records.
 */
export function parseRisFile(content: string): ParsedRisRecord[] {
    const records: ParsedRisRecord[] = [];
    const blocks = content.split(/\r?\n\s*ER\s{2}-\s*\r?\n/i);
    for (const block of blocks) {
        const fields: Record<string, string[]> = {};
        const lines = block.split(/\r?\n/);
        for (const line of lines) {
            const match = line.match(RIS_TAG_REGEX);
            if (!match) continue;
            const tag = match[1];
            const value = match[2];
            if (!fields[tag]) fields[tag] = [];
            fields[tag].push(value);
        }
        if (Object.keys(fields).length > 0) records.push({fields});
    }
    return records.filter(r => Object.keys(r.fields).length > 0);
}

/**
 * Maps an RIS record to the insert payload for the articles table (snake_case).
 */
export function mapRisRecordToArticle(record: ParsedRisRecord, projectId: string): ArticleInsertPayload {
    const title = first(record, 'TI') ?? first(record, 'T1') ?? t('articles', 'risNoTitle');
    const authors = all(record, 'AU');
    const py = parseYear(first(record, 'PY'));
    const da = parseDateParts(first(record, 'DA'));
    const y1 = parseDateParts(first(record, 'Y1'));
    const year = py ?? da.year ?? y1.year;
    const month = da.month ?? y1.month;
    const day = da.day ?? y1.day;
    const {url_landing, url_pdf} = buildUrls(record);
    const keywords = buildKeywords(record);

    return {
        project_id: projectId,
        title,
        abstract: first(record, 'AB') ?? null,
        language: first(record, 'LA') ?? null,
        publication_year: year,
        publication_month: month,
        publication_day: day,
        journal_title: first(record, 'JO') ?? first(record, 'JF') ?? first(record, 'T2') ?? null,
        journal_issn: first(record, 'SN') ?? null,
        journal_eissn: null,
        journal_publisher: first(record, 'PB') ?? null,
        volume: first(record, 'VL') ?? null,
        issue: first(record, 'IS') ?? null,
        pages: buildPages(record),
        article_type: first(record, 'TY') ?? null,
        publication_status: null,
        open_access: null,
        license: null,
        doi: first(record, 'DO') ?? null,
        pmid: first(record, 'PMID') ?? first(record, 'PM') ?? null,
        pmcid: null,
        arxiv_id: null,
        pii: null,
        keywords,
        authors: authors.length > 0 ? authors : null,
        mesh_terms: null,
        url_landing,
        url_pdf,
        ingestion_source: 'RIS',
        source_payload: {
            ris_fields: record.fields,
        },
    };
}
