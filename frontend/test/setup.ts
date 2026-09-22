// Import localStorage mock BEFORE anything else
import './mocks/localStorage';

import '@testing-library/jest-dom';
import {afterAll, afterEach, beforeAll, vi} from 'vitest';
import {cleanup} from '@testing-library/react';
import {server} from './mocks/server';

// `@/integrations/supabase/client` calls createClient at module scope and
// throws "supabaseUrl is required" without a URL. Stubbing here — overriding
// any local .env — makes every spec see the same env locally and in CI, which
// has none. Hoisted so it lands before any import can reach the client.
vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
});

// Extend expect with jest-dom matchers

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vi {
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      interface JestAssertion<T = any>
      extends jest.Matchers<Promise<void>, T> {}
  }
}

// Clean DOM after each test
afterEach(() => {
  cleanup();
  // ...and the per-browser preferences a component may have written. A
  // remembered toggle that survives into the next test silently changes the
  // layout it renders in, which reads as an unrelated failure in whichever
  // test happens to run after.
  localStorage.clear();
});

// Configure MSW for API mocks
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Mock window.matchMedia (needed for components using media queries)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock ResizeObserver (needed for some components)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver (needed for lazy loading)
global.IntersectionObserver = class IntersectionObserver {
  root: Element | Document | null = null;
  rootMargin: string = '';
  thresholds: ReadonlyArray<number> = [];
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
};

// Mock PDF.js (needed for PDF components)
(globalThis as Record<string, unknown>).pdfjsLib = {
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: () => Promise.resolve({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () => Promise.resolve({
        getViewport: () => ({ width: 800, height: 600 }),
        render: () => ({
          promise: Promise.resolve(),
        }),
      }),
    }),
  }),
} as unknown;

// Radix Select drives its listbox through pointer-capture APIs jsdom does not
// implement; without these no Select trigger opens under test.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;
Element.prototype.scrollIntoView = () => undefined;
