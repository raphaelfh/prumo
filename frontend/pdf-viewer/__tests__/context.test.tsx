import {render, screen, act} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {ViewerProvider, useViewerStore, useViewerStoreApi} from '../core/context';
import {createViewerStore} from '../core/store';
import type {ViewerState} from '../core/state';

function CurrentScale() {
  const scale = useViewerStore((s: ViewerState) => s.scale);
  return <span data-testid="scale">{scale.toFixed(2)}</span>;
}

function ScaleSetter({to}: {to: number}) {
  const setScale = useViewerStore((s: ViewerState) => s.actions.setScale);
  return (
    <button data-testid="set-scale" onClick={() => setScale(to)}>
      set
    </button>
  );
}

describe('<ViewerProvider> + useViewerStore', () => {
  it('exposes the store state to descendants', () => {
    render(
      <ViewerProvider>
        <CurrentScale />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('scale').textContent).toBe('1.00');
  });

  it('updates descendants when an action mutates state', async () => {
    const {getByTestId} = render(
      <ViewerProvider>
        <CurrentScale />
        <ScaleSetter to={2} />
      </ViewerProvider>,
    );
    await act(async () => {
      getByTestId('set-scale').click();
    });
    expect(getByTestId('scale').textContent).toBe('2.00');
  });

  it('throws when useViewerStore is called outside a ViewerProvider', () => {
    function Orphan() {
      useViewerStore((s: ViewerState) => s.scale);
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(
      /useViewerStore must be used within a ViewerProvider/,
    );
    spy.mockRestore();
  });

  it('useViewerStoreApi returns the underlying StoreApi', () => {
    let captured: ReturnType<typeof useViewerStoreApi> | null = null;
    function Capture() {
      captured = useViewerStoreApi();
      return null;
    }
    render(
      <ViewerProvider>
        <Capture />
      </ViewerProvider>,
    );
    expect(captured).not.toBeNull();
    expect(typeof captured!.getState).toBe('function');
    expect(typeof captured!.setState).toBe('function');
    expect(typeof captured!.subscribe).toBe('function');
  });

  it('accepts an externally created store via the `store` prop', () => {
    const external = createViewerStore({scale: 0.75});
    render(
      <ViewerProvider store={external}>
        <CurrentScale />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('scale').textContent).toBe('0.75');
  });

  it('accepts initial state via the `initial` prop when no store is passed', () => {
    render(
      <ViewerProvider initial={{scale: 1.5}}>
        <CurrentScale />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('scale').textContent).toBe('1.50');
  });

  // The critical multi-instance integration test.
  it('two ViewerProvider instances on the same page have isolated state', async () => {
    function Pair() {
      return (
        <>
          <ViewerProvider>
            <div data-testid="left">
              <CurrentScale />
              <ScaleSetter to={2} />
            </div>
          </ViewerProvider>
          <ViewerProvider>
            <div data-testid="right">
              <CurrentScale />
              <ScaleSetter to={3} />
            </div>
          </ViewerProvider>
        </>
      );
    }
    const {getByTestId} = render(<Pair />);
    const leftScale = () =>
      getByTestId('left').querySelector('[data-testid="scale"]')!.textContent;
    const rightScale = () =>
      getByTestId('right').querySelector('[data-testid="scale"]')!.textContent;
    expect(leftScale()).toBe('1.00');
    expect(rightScale()).toBe('1.00');

    await act(async () => {
      getByTestId('left').querySelector<HTMLButtonElement>(
        '[data-testid="set-scale"]',
      )!.click();
    });
    expect(leftScale()).toBe('2.00');
    expect(rightScale()).toBe('1.00'); // ← unchanged

    await act(async () => {
      getByTestId('right').querySelector<HTMLButtonElement>(
        '[data-testid="set-scale"]',
      )!.click();
    });
    expect(leftScale()).toBe('2.00'); // ← unchanged
    expect(rightScale()).toBe('3.00');
  });
});
