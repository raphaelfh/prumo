/**
 * Author row model for Zotero-style editing (person vs single-field / org).
 * Persisted form: ordered string[] on articles.authors ("Last, First" or single name).
 */
import {v4 as uuidv4} from 'uuid';

export type AuthorRowMode = 'person' | 'single';

export interface AuthorFormRow {
    id: string;
    mode: AuthorRowMode;
    lastName: string;
    firstName: string;
    singleName: string;
}

export function newAuthorRow(partial?: Partial<Omit<AuthorFormRow, 'id'>>): AuthorFormRow {
    return {
        id: uuidv4(),
        mode: partial?.mode ?? 'person',
        lastName: partial?.lastName ?? '',
        firstName: partial?.firstName ?? '',
        singleName: partial?.singleName ?? '',
    };
}

/** Match backend normalize_author_display_name for person rows. */
export function serializeAuthorRow(row: AuthorFormRow): string | null {
    if (row.mode === 'single') {
        const s = row.singleName.trim();
        return s || null;
    }
    const first = row.firstName.trim();
    const last = row.lastName.trim();
    if (first && last) return `${last}, ${first}`;
    return first || last || null;
}

export function authorsFromRows(rows: AuthorFormRow[]): string[] | null {
    const out: string[] = [];
    for (const row of rows) {
        const s = serializeAuthorRow(row);
        if (s) out.push(s);
    }
    return out.length ? out : null;
}

/**
 * Heuristic: first comma splits Last / First; otherwise single-field mode.
 */
export function parseDisplayNameToRow(display: string): Omit<AuthorFormRow, 'id'> {
    const t = display.trim();
    if (!t) {
        return {mode: 'person', lastName: '', firstName: '', singleName: ''};
    }
    const idx = t.indexOf(',');
    if (idx === -1) {
        return {mode: 'single', lastName: '', firstName: '', singleName: t};
    }
    return {
        mode: 'person',
        lastName: t.slice(0, idx).trim(),
        firstName: t.slice(idx + 1).trim(),
        singleName: '',
    };
}

export function rowsFromAuthorsArray(authors: string[] | null | undefined): AuthorFormRow[] {
    if (!authors?.length) {
        return [newAuthorRow()];
    }
    return authors.map((a) => newAuthorRow(parseDisplayNameToRow(a)));
}
