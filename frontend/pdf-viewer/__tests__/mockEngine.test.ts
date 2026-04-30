import {describe, expect, it, vi} from 'vitest';

import {createMockEngine} from '../engines/mock';

describe('createMockEngine', () => {
  it('returns the configured numPages and fingerprint', async () => {
    const engine = createMockEngine({numPages: 4, fingerprint: 'fp-foo'});
    const doc = await engine.load({kind: 'data', data: new Uint8Array(1)});
    expect(doc.numPages).toBe(4);
    expect(doc.fingerprint).toBe('fp-foo');
  });

  it('getPage returns a handle whose render fires onRender and sizes the canvas', async () => {
    const onRender = vi.fn();
    const engine = createMockEngine({
      numPages: 2,
      pageSize: {width: 100, height: 200},
      onRender,
    });
    const doc = await engine.load({kind: 'data', data: new Uint8Array(1)});
    const page = await doc.getPage(2);
    const canvas = {width: 0, height: 0, getContext: () => null} as unknown as HTMLCanvasElement;
    const result = await page.render({canvas, scale: 1.5});
    expect(onRender).toHaveBeenCalledOnce();
    expect(result.width).toBe(150);
    expect(result.height).toBe(300);
    expect(canvas.width).toBe(150);
  });

  it('getPage rejects out-of-range page numbers', async () => {
    const engine = createMockEngine({numPages: 2});
    const doc = await engine.load({kind: 'data', data: new Uint8Array(1)});
    await expect(doc.getPage(0)).rejects.toThrow(RangeError);
    await expect(doc.getPage(3)).rejects.toThrow(RangeError);
  });

  it('getTextContent returns a single TextItem per page from the configured text', async () => {
    const engine = createMockEngine({numPages: 2, text: ['hello', 'world']});
    const doc = await engine.load({kind: 'data', data: new Uint8Array(1)});
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    expect(content.items).toHaveLength(1);
    expect(content.items[0].text).toBe('hello');
    expect(content.items[0].charStart).toBe(0);
    expect(content.items[0].charEnd).toBe(5);
  });

  it('renderTextLayer paints a span carrying the page text', async () => {
    const engine = createMockEngine({numPages: 1, text: ['hi']});
    const doc = await engine.load({kind: 'data', data: new Uint8Array(1)});
    const page = await doc.getPage(1);
    const container = document.createElement('div');
    await page.renderTextLayer({container, scale: 1});
    expect(container.querySelector('span')?.textContent).toBe('hi');
    expect(container.querySelector<HTMLElement>('span')?.dataset.mockPage).toBe('1');
  });

  it('rejects render when signal is already aborted', async () => {
    const engine = createMockEngine({numPages: 1});
    const doc = await engine.load({kind: 'data', data: new Uint8Array(1)});
    const page = await doc.getPage(1);
    const controller = new AbortController();
    controller.abort();
    const canvas = {width: 0, height: 0} as HTMLCanvasElement;
    await expect(
      page.render({canvas, scale: 1, signal: controller.signal}),
    ).rejects.toThrow('aborted');
  });
});
