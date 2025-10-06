import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './mocks/server';

// Estender expect com matchers do jest-dom
declare global {
  namespace Vi {
    interface JestAssertion<T = any>
      extends jest.Matchers<void, T>,
        jest.Matchers<Promise<void>, T> {}
  }
}

// Limpar DOM após cada teste
afterEach(() => {
  cleanup();
});

// Configurar MSW para mock de APIs
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Mock do window.matchMedia (necessário para componentes que usam media queries)
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

// Mock do ResizeObserver (necessário para alguns componentes)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock do IntersectionObserver (necessário para lazy loading)
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock do PDF.js (necessário para componentes PDF)
global.pdfjsLib = {
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
} as any;
