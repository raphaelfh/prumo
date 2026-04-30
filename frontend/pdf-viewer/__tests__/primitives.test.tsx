import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {render, screen, waitFor} from '@testing-library/react';
import {beforeAll, describe, expect, it, vi} from 'vitest';

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
    'renders pages with data-page-number attributes after load',
    async () => {
      const source = {
        kind: 'data' as const,
        data: fixtureBytes,
      };

      const {container} = render(<PrumoPdfViewer source={source} />);

      // Wait for all 3 Viewer.Page wrapper divs to appear.
      // data-page-number lives on Viewer.Page's <div>, not on the <canvas>.
      await waitFor(
        () => {
          // Specifically target the Viewer.Page wrappers (div elements)
          const pages = container.querySelectorAll('div[data-page-number]');
          expect(pages.length).toBe(3);
        },
        {timeout: 10000},
      );

      const pages = Array.from(container.querySelectorAll('div[data-page-number]'));
      const nums = pages.map((p) => Number(p.getAttribute('data-page-number')));
      expect(nums).toEqual([1, 2, 3]);
    },
    15000, // pdfjs worker startup + 3-page async load can exceed 5 s
  );
});
