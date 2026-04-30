import {describe, expect, it, vi, afterEach} from 'vitest';
import {isMac, modifierLabel, modifierKey} from './platform';

describe('platform', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects mac via userAgent', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)'});
    expect(isMac()).toBe(true);
  });

  it('returns false for non-mac userAgent', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
    expect(isMac()).toBe(false);
  });

  it('returns ⌘ for mac modifier label', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
    expect(modifierLabel()).toBe('⌘');
  });

  it('returns Ctrl for non-mac modifier label', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows)'});
    expect(modifierLabel()).toBe('Ctrl');
  });

  it('returns metaKey for mac modifier event prop', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
    expect(modifierKey()).toBe('metaKey');
  });

  it('returns ctrlKey for non-mac modifier event prop', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows)'});
    expect(modifierKey()).toBe('ctrlKey');
  });
});
