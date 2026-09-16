/**
 * Search quality against a wrapped, multi-line PDF — the regression that made
 * find-in-document unusable: pdf.js hands out text as fragments with the line
 * break carried on `hasEOL`, so the old `items.join('')` glued the last word of
 * every line onto the first word of the next.
 *
 * `__fixtures__/wrapped-text.pdf` is a hand-authored one-page PDF that draws
 * one line per `Tj`, which is what makes pdf.js set `hasEOL`. Joining its
 * fragments naively produces exactly the three defects asserted below —
 * `clinicalmachine`, `ontemporally`, `journalhttps` — plus a hyphenated word
 * split across a line break.
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
const fixturePath = resolve(__dirname, '../__fixtures__/wrapped-text.pdf');

let doc: PDFDocumentHandle;

beforeAll(async () => {
  doc = await pdfJsEngine.load({kind: 'data', data: new Uint8Array(readFileSync(fixturePath))});
});

describe('page text of a wrapped PDF', () => {
  it('guards the precondition: pdf.js really does stream this page as EOL fragments', async () => {
    // If this ever fails, the fixture stopped exercising the bug and every
    // assertion below would pass vacuously.
    const page = await doc.getPage(1);
    const {items} = await page.getTextContent();
    expect(items.length).toBeGreaterThan(1);
    expect(items.some((i) => i.hasEOL)).toBe(true);
    expect(items.map((i) => i.text).join('')).toContain('clinicalmachine');
  });

  it('separates the words a line break falls between', async () => {
    const {text} = await getPageText(doc, 1);
    expect(text).toContain('clinical machine learning models locally on temporally stamped data');
    expect(text).not.toContain('clinicalmachine');
    expect(text).not.toContain('ontemporally');
  });

  it('does not invent a word across a line break', async () => {
    const {text} = await getPageText(doc, 1);
    expect(text).not.toContain('journalhttps');
    expect(text).toContain('journal https://example.org/preprint');
  });

  it('rejoins a word hyphenated across a line break', async () => {
    const {text} = await getPageText(doc, 1);
    expect(text).toContain('hyperparameter sweep');
    expect(text).not.toContain('hyper- parameter');
  });

  it('maps every character of the page back to a text item', async () => {
    const {text, sources} = await getPageText(doc, 1);
    expect(text.length).toBeGreaterThan(150);
    expect(sources).toHaveLength(text.length);
    expect(sources.every((s) => s.itemIndex >= 0 && s.offset >= 0)).toBe(true);
  });
});
