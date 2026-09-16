/**
 * Search quality against a real, multi-line PDF — the regression that made
 * find-in-document unusable: pdf.js hands out text as fragments with the line
 * break carried on `hasEOL`, so the old `items.join('')` glued the last word of
 * every line onto the first word of the next.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {beforeAll, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const {pdfJsEngine} = await import('../engines/pdfjs');
const {getPageText} = await import('../services/searchService');

legacyPdfjs.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
import type {PDFDocumentHandle} from '../core/engine';

const __dirname = dirname(fileURLToPath(import.meta.url));
// A real-world typeset paper: wrapped paragraphs, running heads, hyperlinks.
const fixturePath = resolve(__dirname, '../../../test_files/machine_learnig _pdf_file_for_testing.pdf');

let doc: PDFDocumentHandle;

beforeAll(async () => {
  doc = await pdfJsEngine.load({kind: 'data', data: new Uint8Array(readFileSync(fixturePath))});
});

describe('page text of a real PDF', () => {
  it('separates the words a line break falls between', async () => {
    const {text} = await getPageText(doc, 1);
    // The title wraps mid-phrase; joining the fragments glued it together.
    expect(text).toContain('clinical machine learning models locally on temporally stamped data');
    expect(text).not.toContain('clinicalmachine');
    expect(text).not.toContain('ontemporally');
  });

  it('does not invent a word across a line break', async () => {
    const {text} = await getPageText(doc, 1);
    expect(text).not.toContain('journalhttps');
  });

  it('maps every character of the page back to a text item', async () => {
    const {text, sources} = await getPageText(doc, 1);
    expect(text.length).toBeGreaterThan(500);
    expect(sources).toHaveLength(text.length);
    expect(sources.every((s) => s.itemIndex >= 0 && s.offset >= 0)).toBe(true);
  });
});
