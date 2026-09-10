/**
 * Off-screen pages skip rendering, sized exactly.
 *
 * Dragging a split pane (Articles, the run screens) changes the viewer's width
 * on every frame, and every page's text layer — hundreds of absolutely
 * positioned spans — used to be laid out again each time: 120ms+ frames on a
 * 14-page paper. `content-visibility: auto` skips the off-screen pages; the
 * size a skipped page keeps must be the size it renders at, not a guess, or
 * scroll-to-page and the page-sync observer drift.
 *
 * jsdom has no layout, so this pins the contract, not the frame time.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {render, waitFor} from '@testing-library/react';
import {beforeAll, describe, expect, it, vi} from 'vitest';

// Same shim as primitives.test.tsx: the bundled pdfjs-dist is browser-only.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const {PrumoPdfViewer} = await import('../PrumoPdfViewer');
const {createViewerStore} = await import('../core/store');

legacyPdfjs.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/three-page.pdf');
let fixtureBytes: Uint8Array;

beforeAll(() => {
  fixtureBytes = new Uint8Array(readFileSync(fixturePath));
  HTMLCanvasElement.prototype.getContext = () => null;
});

/** Page 1's size in PDF units. pdf.js transfers the bytes to its worker, so
 *  every load gets its own copy. */
async function firstPageSize(): Promise<{width: number; height: number}> {
  const doc = await legacyPdfjs.getDocument({data: fixtureBytes.slice()}).promise;
  const [x1, y1, x2, y2] = (await doc.getPage(1)).view;
  return {width: x2 - x1, height: y2 - y1};
}

async function renderFirstPage(store: ReturnType<typeof createViewerStore>): Promise<HTMLElement> {
  const {container} = render(
    <PrumoPdfViewer source={{kind: 'data', data: fixtureBytes.slice()}} store={store} />,
  );
  return waitFor(
    () => {
      const el = container.querySelector<HTMLElement>('[data-page-number="1"]');
      expect(el).not.toBeNull();
      expect(el!.style.contentVisibility).not.toBe('');
      return el!;
    },
    {timeout: 5000},
  );
}

describe('Viewer.Page', () => {
  it('skips rendering while off screen, keeping the size it renders at', async () => {
    const size = await firstPageSize();
    const store = createViewerStore();
    const {scale} = store.getState();

    const page = await renderFirstPage(store);

    expect(page.style.contentVisibility).toBe('auto');
    expect(page.style.containIntrinsicSize).toBe(
      `auto ${size.width * scale}px auto ${size.height * scale}px`,
    );
  });

  it('swaps the kept width and height for a quarter-turn rotation', async () => {
    const size = await firstPageSize();
    // Precondition: a square page would make the swap unobservable.
    expect(size.width).not.toBe(size.height);

    const page = await renderFirstPage(createViewerStore({scale: 1.5, rotation: 90}));

    expect(page.style.containIntrinsicSize).toBe(
      `auto ${size.height * 1.5}px auto ${size.width * 1.5}px`,
    );
  });
});
