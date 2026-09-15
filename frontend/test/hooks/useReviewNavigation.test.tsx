import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {useReviewNavigation} from '@/hooks/extraction/useReviewNavigation';

const rows = [
  {instanceId: 'i', fieldId: 'a', sectionId: 's', label: 'A', pending: true},
  {instanceId: 'i', fieldId: 'b', sectionId: 's', label: 'B', pending: false},
  {instanceId: 'j', fieldId: 'c', sectionId: 't', label: 'C', pending: true},
];
describe('useReviewNavigation', () => {
  it('walks previous and next pending without wrapping and keeps one disclosure', () => {
    const {result} = renderHook(() => useReviewNavigation({rows, scope: 'run'}));
    expect(result.current.current?.fieldId).toBe('a');
    act(() => result.current.next());
    expect(result.current.current?.fieldId).toBe('c');
    expect(result.current.canNext).toBe(false);
    act(() => result.current.previous());
    expect(result.current.current?.fieldId).toBe('b');
    act(() => result.current.toggleDisclosure(rows[0]));
    act(() => result.current.toggleDisclosure(rows[2]));
    expect(result.current.open?.fieldId).toBe('c');
    expect(result.current.current?.fieldId).toBe('b');
  });
  it('clears invalid coordinates and focus on article or entry changes', () => {
    const {result, rerender} = renderHook(({scope, items}) => useReviewNavigation({rows: items, scope}), {initialProps: {scope: 'a', items: rows}});
    act(() => {result.current.select(rows[2]); result.current.toggleFocus();});
    rerender({scope: 'b', items: rows.slice(0, 1)});
    expect(result.current.current?.fieldId).toBe('a');
    expect(result.current.focused).toBe(false);
    expect(result.current.open).toBeNull();
  });
  it('focuses only explicit navigation destinations', () => {
    const onNavigate = vi.fn();
    const {result} = renderHook(() => useReviewNavigation({rows, scope: 'run', onNavigate}));
    act(() => result.current.toggleDisclosure(rows[0]));
    expect(onNavigate).not.toHaveBeenCalled();
    act(() => result.current.next());
    expect(onNavigate).toHaveBeenCalledWith(rows[2]);
  });
});

import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';

describe('review shortcut guards', () => {
  it.each(['select', 'editable child', 'shadow editable child', 'menu', 'dialog'])('does not accept inside %s', kind => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({enabled: true, bindings: [{type: 'chord', key: 'a', handler}]}));
    const host = document.createElement(kind === 'select' ? 'select' : 'div');
    document.body.appendChild(host);
    let target: HTMLElement = host;
    if (kind.includes('editable')) {
      const parent = document.createElement('div');
      parent.setAttribute('contenteditable', 'true');
      target = document.createElement('span');
      parent.appendChild(target);
      if (kind.startsWith('shadow')) host.attachShadow({mode: 'open'}).appendChild(parent);
      else host.appendChild(parent);
    }
    if (kind === 'menu' || kind === 'dialog') {host.setAttribute('role', kind); host.setAttribute('data-state', 'open'); target = document.body;}
    target.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', bubbles: true, composed: true}));
    expect(handler).not.toHaveBeenCalled();
    host.remove();
  });
});
