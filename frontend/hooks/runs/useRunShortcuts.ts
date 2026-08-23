import { useEffect, useRef } from 'react';
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from '@/lib/runs/shortcuts';

export interface RunShortcutHandlers {
  /** The run's article worklist. Fewer than two makes J/K inert. */
  articles: { id: string }[];
  currentArticleId: string;
  onNavigateToArticle: (id: string) => void;
  /** "\" — the source (PDF) panel. */
  onTogglePanel: () => void;
  /** ⌘K / Ctrl+K. Omit on a screen with no palette. */
  onTogglePalette?: () => void;
  /** Escape. Omit on a screen with no palette. */
  onClosePalette?: () => void;
}

/**
 * The single owner of the run screens' keyboard bindings (extraction + QA).
 *
 * The listener registers ONCE (empty deps) and reads the changing callbacks
 * through a ref, so it does not re-bind on every render. Cleanup goes through
 * `return`, never `try/finally` — the React Compiler runs with
 * `panicThreshold: 'all_errors'` and rejects the latter in a hook body.
 *
 * ⌘B (sidebar) is deliberately absent: it is owned by RunWorkspaceShell, and
 * appears in `RUN_SHORTCUTS` only so the help panel can document it.
 */
export function useRunShortcuts(handlers: RunShortcutHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = ref.current;
      const target = e.target as HTMLElement | null;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        !!target?.isContentEditable;

      // ⌘K / Ctrl+K — toggle the command palette.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isEditing) return;
        e.preventDefault();
        h.onTogglePalette?.();
        return;
      }

      // Everything below is an unmodified single key, never while typing.
      if (e.metaKey || e.ctrlKey || e.altKey || isEditing) return;

      if (e.key === 'Escape') {
        h.onClosePalette?.();
        return;
      }
      if (e.key === '\\') {
        e.preventDefault();
        h.onTogglePanel();
        return;
      }

      if (h.articles.length < 2) return;
      const i = h.articles.findIndex((a) => a.id === h.currentArticleId);
      if (i < 0) return;
      const key = e.key.toLowerCase();
      if (key === ARTICLE_NEXT_KEY.toLowerCase()) {
        if (i < h.articles.length - 1) h.onNavigateToArticle(h.articles[i + 1].id);
        return;
      }
      if (key === ARTICLE_PREV_KEY.toLowerCase()) {
        if (i > 0) h.onNavigateToArticle(h.articles[i - 1].id);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
