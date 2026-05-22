// Import localStorage mock BEFORE anything else
import './mocks/localStorage';

import '@testing-library/jest-dom';
import {afterAll, afterEach, beforeAll} from 'vitest';
import {cleanup} from '@testing-library/react';
import {server} from './mocks/server';

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
