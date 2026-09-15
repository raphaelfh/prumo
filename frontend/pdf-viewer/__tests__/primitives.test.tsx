import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {render, screen, waitFor} from '@testing-library/react';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

// react-pdf's bundled pdfjs-dist is browser-only.
// Shim it with the Node-compatible legacy build (same version family).
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

// Set up the worker for the legacy pdfjs.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

// Import AFTER the mock is registered so components see the shim.
const {PrumoPdfViewer} = await import('../PrumoPdfViewer');
const {createViewerStore} = await import('../core/store');

// Override workerSrc AFTER engine import — the engine module unconditionally
// writes a Vite-bundled URL that doesn't exist in Node.
legacyPdfjs.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../__fixtures__/three-page.pdf');

let fixtureBytes: Uint8Array;

beforeAll(() => {
  fixtureBytes = new Uint8Array(readFileSync(fixturePath));

  // jsdom doesn't implement HTMLCanvasElement.getContext.
  // Stub it out so CanvasLayer doesn't crash (render errors are caught
  // internally and logged as warnings, not thrown to the test).
  HTMLCanvasElement.prototype.getContext = () => null;

  // The virtualizer treats a zero-size scroller as "not yet measurable" and
  // mounts nothing (@tanstack/virtual-core's calculateRange bails out when
  // outerSize === 0); jsdom never lays out real dimensions, so without this
  // stub every page would stay unmounted, not just the ones off-screen.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('<PrumoPdfViewer> smoke tests', () => {
  it('renders LoadingState while the document is loading', async () => {
    // Use a lazy source with a never-resolving promise to keep state in "loading".
    const source = {
      kind: 'lazy' as const,
      load: (): Promise<never> => new Promise(() => {}),
    };

    render(<PrumoPdfViewer source={source} />);

    expect(await screen.findByText('Loading PDF...')).toBeInTheDocument();
  });

  it('renders ErrorState when the source fails to load', async () => {
    // Non-PDF bytes trigger an engine error → ErrorState should appear.
    const source = {
      kind: 'data' as const,
      data: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
    };

    render(<PrumoPdfViewer source={source} />);

    await waitFor(
      () => {
        expect(screen.getByText('Failed to load PDF')).toBeInTheDocument();
      },
      {timeout: 5000},
    );
  });

  it(
    'renders the first pages with data-page-number attributes after load',
    async () => {
      const source = {
        kind: 'data' as const,
        data: fixtureBytes,
      };
      const store = createViewerStore();

      const {container} = render(<PrumoPdfViewer source={source} store={store} />);
      await waitFor(
        () => {
          const nums = [...container.querySelectorAll('div[data-page-number]')].map((p) =>
            Number(p.getAttribute('data-page-number')),
          );
          expect(nums).toEqual([1, 2]);
        },
        {timeout: 10000},
      );
      // Precondition this test's overscan-1 mounting depends on: the stubbed
      // 300px viewport (offsetHeight above) is shorter than the fixture's
      // first page, so only the pages next to it mount, not the whole
      // document.
      expect(store.getState().pageSizes[1]?.height).toBeGreaterThan(300);
    },
    15000, // pdfjs worker startup + load can exceed 5 s
  );
});
