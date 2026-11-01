import {describe, expect, it} from 'vitest';

import {screeningKeyAction} from '@/lib/screening/keymap';

function key(k: string, overrides: Partial<Parameters<typeof screeningKeyAction>[0]> = {}) {
  return {key: k, metaKey: false, ctrlKey: false, altKey: false, target: document.body, ...overrides};
}

describe('screeningKeyAction', () => {
  it.each([
    ['1', 'include'],
    ['2', 'exclude'],
    ['3', 'maybe'],
  ] as const)('maps %s to %s', (k, decision) => {
    expect(screeningKeyAction(key(k), false, 'title_abstract')).toEqual({kind: 'decide', decision});
  });

  it('opens reasons on e and E', () => {
    expect(screeningKeyAction(key('e'), false, 'title_abstract')).toEqual({kind: 'open_reasons'});
    expect(screeningKeyAction(key('E'), false, 'title_abstract')).toEqual({kind: 'open_reasons'});
  });

  it('picks reason n-1 while reasons are open', () => {
    expect(screeningKeyAction(key('2'), true, 'title_abstract')).toEqual({kind: 'reason', index: 1});
    expect(screeningKeyAction(key('9'), true, 'title_abstract')).toEqual({kind: 'reason', index: 8});
    // While reasons are open, digits pick reasons and `e` does nothing.
    expect(screeningKeyAction(key('e'), true, 'title_abstract')).toBeNull();
    expect(screeningKeyAction(key('0'), true, 'title_abstract')).toBeNull();
  });

  it('ignores keys with modifiers', () => {
    expect(screeningKeyAction(key('1', {ctrlKey: true}), false, 'title_abstract')).toBeNull();
    expect(screeningKeyAction(key('1', {metaKey: true}), false, 'title_abstract')).toBeNull();
    expect(screeningKeyAction(key('1', {altKey: true}), false, 'title_abstract')).toBeNull();
  });

  it('ignores keys typed into a text field', () => {
    for (const tag of ['textarea', 'input', 'select']) {
      expect(screeningKeyAction(key('1', {target: document.createElement(tag)}), false, 'title_abstract')).toBeNull();
    }
    const editable = document.createElement('div');
    // jsdom implements neither `isContentEditable` nor the property's reflection.
    editable.setAttribute('contenteditable', 'true');
    expect(screeningKeyAction(key('1', {target: editable}), false, 'title_abstract')).toBeNull();
  });

  it('returns null for 1-9 picks while not armed is a decision, not a reason', () => {
    expect(screeningKeyAction(key('4'), false, 'title_abstract')).toBeNull();
  });

  it('ignores unknown keys', () => {
    expect(screeningKeyAction(key('x'), false, 'title_abstract')).toBeNull();
    expect(screeningKeyAction(key('4'), false, 'title_abstract')).toBeNull();
    expect(screeningKeyAction(key('Escape'), true, 'title_abstract')).toBeNull();
  });
});
