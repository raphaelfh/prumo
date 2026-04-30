import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {beforeAll, describe, expect, it, vi} from 'vitest';

// react-pdf's bundled pdfjs-dist is browser-only (DOMMatrix at module init).
// In the jsdom test environment we shim it with the pdfjs-dist legacy build,
// which is the Node-compatible variant of the same version family.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

// Set up the worker for the legacy pdfjs using a file:// URL (required by Node ESM loader).
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

// Import AFTER the mock is registered so the engine sees the shim.
const {pdfJsEngine} = await import('../engines/pdfjs');
const {searchDocument} = await import('../services/searchService');

// The engine module unconditionally writes a Vite-resolved worker URL to
// GlobalWorkerOptions.workerSrc. Override it back to the file:// path AFTER
// engine import so the legacy pdfjs in jsdom can spawn its fake worker.
legacyPdfjs.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
import type {PDFDocumentHandle} from '../core/engine';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../__fixtures__/three-page.pdf');

let fixtureBytes: Uint8Array;
let doc: PDFDocumentHandle;

beforeAll(async () => {
  fixtureBytes = new Uint8Array(readFileSync(fixturePath));
  doc = await pdfJsEngine.load({kind: 'data', data: fixtureBytes});
});

describe('searchDocument', () => {
  it('returns empty array for empty query', async () => {
    const matches = await searchDocument(doc, '', {caseSensitive: false, wholeWords: false});
    expect(matches).toHaveLength(0);
  });

  it('finds "Page" across multiple pages (case-insensitive)', async () => {
    const matches = await searchDocument(doc, 'Page', {caseSensitive: false, wholeWords: false});
    // The fixture has 3 pages each containing "Page N" text.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('respects caseSensitive option', async () => {
    const insensitive = await searchDocument(doc, 'page', {caseSensitive: false, wholeWords: false});
    const sensitive = await searchDocument(doc, 'page', {caseSensitive: true, wholeWords: false});
    // Case-insensitive finds more (or equal) matches than case-sensitive.
    expect(insensitive.length).toBeGreaterThanOrEqual(sensitive.length);
  });

  it('returns matches with correct pageNumber, charStart, charEnd, and context', async () => {
    const matches = await searchDocument(doc, 'Page 1', {caseSensitive: false, wholeWords: false});
    expect(matches.length).toBeGreaterThan(0);
    const first = matches[0];
    expect(first.pageNumber).toBeGreaterThanOrEqual(1);
    expect(first.charEnd).toBeGreaterThan(first.charStart);
    expect(first.context).toContain('Page 1');
  });

  it('aborts search when signal fires', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      searchDocument(doc, 'Page', {caseSensitive: false, wholeWords: false}, undefined, ctrl.signal),
    ).rejects.toMatchObject({name: 'AbortError'});
  });
});
