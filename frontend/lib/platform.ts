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
