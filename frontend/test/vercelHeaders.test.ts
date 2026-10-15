/**
 * Pages under /oauth/ must not be framed: vercel.json sends both the legacy
 * and the CSP frame headers for them.
 */
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

interface HeaderEntry {
    source: string;
    headers: {key: string; value: string}[];
}

const config = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8'),
) as {headers: HeaderEntry[]};

describe('vercel.json frame headers', () => {
    it('denies framing for every page under /oauth/', () => {
        const entries = config.headers.filter((entry) => entry.source === '/oauth/(.*)');

        expect(entries).toHaveLength(1);
        expect(entries[0].headers).toEqual(
            expect.arrayContaining([
                {key: 'X-Frame-Options', value: 'DENY'},
                {key: 'Content-Security-Policy', value: "frame-ancestors 'none'"},
            ]),
        );
    });
});
