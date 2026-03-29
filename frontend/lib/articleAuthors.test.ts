import {describe, expect, it} from 'vitest';
import {
    authorsFromRows,
    newAuthorRow,
    parseDisplayNameToRow,
    rowsFromAuthorsArray,
    serializeAuthorRow,
} from './articleAuthors';

describe('articleAuthors', () => {
    it('serializes person as Last, First', () => {
        const row = newAuthorRow({mode: 'person', lastName: 'Doe', firstName: 'Jane'});
        expect(serializeAuthorRow(row)).toBe('Doe, Jane');
    });

    it('serializes single field', () => {
        const row = newAuthorRow({mode: 'single', singleName: 'WHO'});
        expect(serializeAuthorRow(row)).toBe('WHO');
    });

    it('authorsFromRows filters empty', () => {
        expect(authorsFromRows([newAuthorRow()])).toBeNull();
        expect(authorsFromRows([newAuthorRow({mode: 'person', lastName: 'A', firstName: 'B'})])).toEqual(['A, B']);
    });

    it('parseDisplayNameToRow splits on first comma', () => {
        expect(parseDisplayNameToRow('Smith, John, Jr.')).toMatchObject({
            mode: 'person',
            lastName: 'Smith',
            firstName: 'John, Jr.',
        });
    });

    it('rowsFromAuthorsArray yields one empty row when no authors', () => {
        const rows = rowsFromAuthorsArray(null);
        expect(rows).toHaveLength(1);
        expect(serializeAuthorRow(rows[0])).toBeNull();
    });
});
