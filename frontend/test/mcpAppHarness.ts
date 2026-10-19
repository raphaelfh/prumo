/**
 * Test harness for the MCP Apps cards served by the backend
 * (`backend/app/api/mcp/apps/*.html`). It loads the static HTML into the
 * jsdom document, runs its one inline script, records what the card posts
 * to its host and lets a test play the host side of the ext-apps
 * postMessage bridge (JSON-RPC 2.0).
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {expect, vi} from 'vitest';

export interface RpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

type Listener = {
  target: Window | Document;
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};

export interface CardHarness {
  sent(method?: string): RpcMessage[];
  lastRequest(method: string): RpcMessage;
  reply(id: number, result: unknown): void;
  replyError(id: number, error: unknown): void;
  toolResult(callToolResult: Record<string, unknown>): void;
  deliver(data: unknown, source?: Window | null): void;
  setVisibility(state: 'visible' | 'hidden'): void;
  text(): string;
  dispose(): void;
}

export function loadCard(file: 'draft_review.html' | 'ai_run.html'): CardHarness {
  const html = readFileSync(resolve(process.cwd(), 'backend/app/api/mcp/apps', file), 'utf-8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts = parsed.querySelectorAll('script');
  expect(scripts).toHaveLength(1);
  expect(scripts[0].hasAttribute('src')).toBe(false);
  const scriptText = scripts[0].textContent ?? '';
  scripts[0].remove();

  for (const style of Array.from(parsed.querySelectorAll('style'))) {
    document.head.appendChild(document.importNode(style, true));
  }
  for (const node of Array.from(parsed.body.childNodes)) {
    document.body.appendChild(document.importNode(node, true));
  }

  const outgoing: RpcMessage[] = [];
  const originalPostMessage = window.parent.postMessage;
  window.parent.postMessage = vi.fn((message: unknown) => {
    outgoing.push(message as RpcMessage);
  }) as unknown as typeof window.postMessage;

  const listeners: Listener[] = [];
  const originalWindowAdd = window.addEventListener;
  const originalDocumentAdd = document.addEventListener;
  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    listeners.push({target: window, type, listener, options});
    originalWindowAdd.call(window, type, listener, options);
  }) as typeof window.addEventListener;
  document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    listeners.push({target: document, type, listener, options});
    originalDocumentAdd.call(document, type, listener, options);
  }) as typeof document.addEventListener;

  // The card's script is static text from our own repo; run it in this window.
  new Function(scriptText)();

  const deliver = (data: unknown, source: Window | null = window) => {
    window.dispatchEvent(new MessageEvent('message', {data, source}));
  };

  return {
    sent: (method) => outgoing.filter((m) => method === undefined || m.method === method),
    lastRequest: (method) => {
      const matches = outgoing.filter((m) => m.method === method && typeof m.id === 'number');
      expect(matches.length).toBeGreaterThan(0);
      return matches[matches.length - 1];
    },
    reply: (id, result) => deliver({jsonrpc: '2.0', id, result}),
    replyError: (id, error) => deliver({jsonrpc: '2.0', id, error}),
    toolResult: (callToolResult) =>
      deliver({jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: callToolResult}),
    deliver,
    setVisibility: (state) => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => state});
      document.dispatchEvent(new Event('visibilitychange'));
    },
    text: () => document.body.textContent ?? '',
    dispose: () => {
      for (const {target, type, listener, options} of listeners) {
        target.removeEventListener(type, listener, options);
      }
      window.addEventListener = originalWindowAdd;
      document.addEventListener = originalDocumentAdd;
      window.parent.postMessage = originalPostMessage;
      document.body.replaceChildren();
      document.head.replaceChildren();
    },
  };
}
