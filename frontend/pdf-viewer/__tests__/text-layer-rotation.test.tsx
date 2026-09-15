import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {render, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {TextLayer} from '../primitives/TextLayer';
import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, '../primitives/text-layer.css');

describe('text-layer.css rotation rules', () => {
  it('defines a rotate transform for data-main-rotation 90, 180 and 270', () => {
    const css = readFileSync(cssPath, 'utf-8');
    for (const deg of [90, 180, 270]) {
      const rule = new RegExp(
        `\\.pdf-viewer-text-layer\\[data-main-rotation=["']${deg}["']\\][\\s\\S]{0,120}?transform:\\s*rotate\\(${deg}deg\\)`,
      );
      expect(css).toMatch(rule);
    }
  });
});

describe('<TextLayer> rotation wiring', () => {
  it('passes effectiveRotation(page, viewRotation) to renderTextLayer', async () => {
    const onRenderTextLayer = vi.fn();
    const engine = createMockEngine({
      numPages: 1,
      rotation: 90,
      text: ['hello'],
      onRenderTextLayer,
    });
    const doc = await engine.load({kind: 'url', url: 'mock.pdf'});

    const store = createViewerStore({document: doc, viewRotation: 90});

    render(
      <ViewerProvider store={store}>
        <TextLayer pageNumber={1} />
      </ViewerProvider>,
    );

    await waitFor(() => {
      expect(onRenderTextLayer).toHaveBeenCalled();
    });

    const [, opts] = onRenderTextLayer.mock.calls[0];
    // page.rotation (90) + viewRotation (90) wraps to 180.
    expect(opts.rotation).toBe(180);
  });
});
