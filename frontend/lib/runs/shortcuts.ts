/**
 * The run screens' keyboard bindings, in ONE place.
 *
 * `useRunShortcuts` binds from here and `RunHeader.Help` renders from here, so
 * a binding cannot exist on one screen while the help panel advertises
 * something else — which is exactly what happened before this file: the help
 * panel promised J/K on both run screens while only extraction bound them.
 */

type RunShortcutId = 'palette' | 'nextPrev' | 'togglePdf' | 'sidebar' | 'esc';

type RunShortcutCopyKey =
  | 'shortcutPalette'
  | 'shortcutNextPrev'
  | 'shortcutTogglePdf'
  | 'shortcutSidebar'
  | 'shortcutEsc';

export interface RunShortcut {
  id: RunShortcutId;
  /** Display combo, rendered by KbdBadge. */
  combo: string;
  /** Key in the `runs` copy namespace describing what the shortcut does. */
  copyKey: RunShortcutCopyKey;
}

/** Display casing. Matching is case-insensitive (see `useRunShortcuts`). */
export const ARTICLE_NEXT_KEY = 'J';
export const ARTICLE_PREV_KEY = 'K';

export const RUN_SHORTCUTS: readonly RunShortcut[] = [
  { id: 'palette', combo: '⌘K', copyKey: 'shortcutPalette' },
  { id: 'nextPrev', combo: `${ARTICLE_NEXT_KEY} / ${ARTICLE_PREV_KEY}`, copyKey: 'shortcutNextPrev' },
  { id: 'togglePdf', combo: '\\', copyKey: 'shortcutTogglePdf' },
  { id: 'sidebar', combo: '⌘B', copyKey: 'shortcutSidebar' },
  { id: 'esc', combo: 'Esc', copyKey: 'shortcutEsc' },
];
