export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function modifierLabel(): '⌘' | 'Ctrl' {
  return isMac() ? '⌘' : 'Ctrl';
}

export function modifierKey(): 'metaKey' | 'ctrlKey' {
  return isMac() ? 'metaKey' : 'ctrlKey';
}

/**
 * The `aria-keyshortcuts` spelling of a KbdBadge chord: `mod` becomes the
 * modifier this platform binds (the one `modifierKey` reads), `⇧` becomes
 * Shift, and the keys join with `+` — `['mod', '⇧', 'B']` is `Meta+Shift+B`
 * on macOS and `Control+Shift+B` elsewhere.
 */
export function ariaKeyShortcuts(keys: readonly string[]): string {
  return keys
    .map((key) => (key === 'mod' ? (isMac() ? 'Meta' : 'Control') : key === '⇧' ? 'Shift' : key))
    .join('+');
}
