import { useKeyboardShortcuts, type Binding } from '@/hooks/useKeyboardShortcuts';
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from '@/lib/runs/shortcuts';

export interface RunShortcutHandlers {
  /** The run's article worklist. Fewer than two makes J/K inert. */
  articles: { id: string }[];
  currentArticleId: string;
  onNavigateToArticle: (id: string) => void;
  /** ⌘K / Ctrl+K. Omit on a screen with no palette. */
  onTogglePalette?: () => void;
  /** Escape. Omit on a screen with no palette. */
  onClosePalette?: () => void;
}

/**
 * The run screens' article and palette keys (extraction + QA), bound through
 * the shared `useKeyboardShortcuts` so its guards apply: J/K are bare keys, so
 * they stay inert while typing, with a modifier held, or under an open dialog
 * or popover.
 *
 * The palette is itself a dialog, so ⌘K and Escape opt in to firing under one
 * (`allowInDialogs`). ⌘K also opts out of fields (`allowInInputs: false`),
 * which a mod chord would otherwise reach.
 *
 * Deliberately absent, and in `RUN_SHORTCUTS` only so the help panel can document
 * them — each is bound through `useKeyboardShortcuts` by what it toggles: ⌘B
 * (sidebar) by RunWorkspaceShell; ⌘⇧B (source panel) by RunHeader.PanelToggle;
 * ⌘↵ (next required field) and ⌘\ (section rail) by SectionNavLayout.
 */
export function useRunShortcuts({
  articles,
  currentArticleId,
  onNavigateToArticle,
  onTogglePalette,
  onClosePalette,
}: RunShortcutHandlers): void {
  // No wrap-around: past either end (so on a list of one) there is no target.
  const step = (delta: 1 | -1) => {
    const i = articles.findIndex((a) => a.id === currentArticleId);
    const target = i < 0 ? undefined : articles[i + delta];
    if (target) onNavigateToArticle(target.id);
  };

  const bindings: Binding[] = [
    { type: 'chord', key: ARTICLE_NEXT_KEY, handler: () => step(1) },
    { type: 'chord', key: ARTICLE_PREV_KEY, handler: () => step(-1) },
  ];
  if (onTogglePalette) {
    bindings.push({
      type: 'chord',
      key: 'k',
      mod: true,
      allowInInputs: false,
      allowInDialogs: true,
      handler: onTogglePalette,
    });
  }
  if (onClosePalette) {
    bindings.push({ type: 'chord', key: 'Escape', allowInDialogs: true, handler: onClosePalette });
  }

  useKeyboardShortcuts({ bindings, enabled: true });
}
