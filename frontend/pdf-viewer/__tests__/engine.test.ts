import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {beforeAll, describe, expect, it, vi} from 'vitest';

// react-pdf's bundled pdfjs-dist is browser-only (DOMMatrix at module init).
// In the jsdom test environment we shim it with the pdfjs-dist legacy build,
// which is the Node-compatible variant of the same version family.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

// Import AFTER the mock is registered so the engine sees the shim.
const {pdfJsEngine} = await import('../engines/pdfjs');
import type {PDFDocumentHandle} from '../core/engine';

// Set up the worker for the legacy pdfjs using a file:// URL (required by Node ESM loader).
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
legacyPdfjs.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../__fixtures__/three-page.pdf');

let fixtureBytes: Uint8Array;

beforeAll(() => {
  fixtureBytes = new Uint8Array(readFileSync(fixturePath));
});

describe('pdfJsEngine.load', () => {
  let doc: PDFDocumentHandle;

  beforeAll(async () => {
    doc = await pdfJsEngine.load({kind: 'data', data: fixtureBytes});
  });

  it('reports the correct number of pages', () => {
    expect(doc.numPages).toBe(3);
  });

  it('exposes a non-empty fingerprint', () => {
    expect(doc.fingerprint.length).toBeGreaterThan(0);
  });

  it('returns metadata (may be empty for synthetic PDFs)', async () => {
    const meta = await doc.metadata();
    expect(meta).toBeTypeOf('object');
  });

  it('returns an empty outline for a PDF with no bookmarks', async () => {
    const outline = await doc.outline();
    expect(Array.isArray(outline)).toBe(true);
    expect(outline).toHaveLength(0);
  });

  it('getPage returns a handle with size in PDF user space', async () => {
    const page = await doc.getPage(1);
    expect(page.pageNumber).toBe(1);
    expect(page.size.width).toBe(400);
    expect(page.size.height).toBe(600);
  });

  it('page text content has items with char offsets', async () => {
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    expect(tc.items.length).toBeGreaterThan(0);
    expect(tc.items[0].charStart).toBe(0);
    expect(tc.items[0].charEnd).toBeGreaterThan(0);
    // The first item's text should mention 'Page 1' since we drew that
    const allText = tc.items.map((i) => i.text).join('');
    expect(allText).toMatch(/Page 1/);
  });
});

describe('pdfJsEngine load failure', () => {
  it('rejects on non-PDF data', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    await expect(pdfJsEngine.load({kind: 'data', data: garbage})).rejects.toThrow();
  });
});
