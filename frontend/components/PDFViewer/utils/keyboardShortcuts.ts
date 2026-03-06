/**
 * Keyboard shortcuts manager
 * 
 * Features:
 * - Centralized shortcut registration
 * - Conflict prevention
 * - Shortcut contexts (global, viewer, etc)
 * - Help/overlay with shortcut list
 */

export type ShortcutKey = string;
export type ShortcutHandler = (event: KeyboardEvent) => void;

interface Shortcut {
  key: ShortcutKey;
  handler: ShortcutHandler;
  description: string;
  context?: 'global' | 'viewer' | 'edit';
}

class KeyboardShortcutManager {
  private shortcuts: Map<ShortcutKey, Shortcut> = new Map();
  private enabled: boolean = true;

  /**
   * Normalize key to consistent format
   */
  private normalizeKey(event: KeyboardEvent): string {
    const parts: string[] = [];
    
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');

      // Normalize main key
    const key = event.key.length === 1 
      ? event.key.toUpperCase() 
      : event.key;
    
    parts.push(key);
    
    return parts.join('+');
  }

  /**
   * Register shortcut
   */
  register(shortcut: Shortcut): void {
    this.shortcuts.set(shortcut.key, shortcut);
  }

  /**
   * Remove shortcut
   */
  unregister(key: ShortcutKey): void {
    this.shortcuts.delete(key);
  }

  /**
   * Handle keyboard event
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.enabled) return false;

    const normalizedKey = this.normalizeKey(event);
    const shortcut = this.shortcuts.get(normalizedKey);

    if (shortcut) {
      event.preventDefault();
      shortcut.handler(event);
      return true;
    }

    return false;
  }

  /**
   * Enable/disable shortcuts
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get all shortcuts
   */
  getAllShortcuts(): Shortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Get shortcuts by context
   */
  getShortcutsByContext(context: 'global' | 'viewer' | 'edit'): Shortcut[] {
    return Array.from(this.shortcuts.values())
      .filter(s => s.context === context || !s.context);
  }
}

// Singleton instance
export const keyboardManager = new KeyboardShortcutManager();

/**
 * Hook to use keyboard shortcuts
 */
import {useEffect} from 'react';
import {t} from '@/lib/copy';

export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    // Registrar atalhos
    shortcuts.forEach(shortcut => keyboardManager.register(shortcut));

    // Handler global
    const handleKeyDown = (event: KeyboardEvent) => {
      keyboardManager.handleKeyDown(event);
    };

    window.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      shortcuts.forEach(shortcut => keyboardManager.unregister(shortcut.key));
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts]);
}

/**
 * PDFViewer default shortcuts
 */
export const defaultShortcuts: Shortcut[] = [
  {
    key: 'PageDown',
    handler: () => console.log('Next page'),
      description: t('pdf', 'shortcutNextPage'),
    context: 'viewer',
  },
  {
    key: 'PageUp',
    handler: () => console.log('Previous page'),
      description: t('pdf', 'shortcutPrevPage'),
    context: 'viewer',
  },
  {
    key: 'Home',
    handler: () => console.log('First page'),
      description: t('pdf', 'shortcutFirstPage'),
    context: 'viewer',
  },
  {
    key: 'End',
    handler: () => console.log('Last page'),
      description: t('pdf', 'shortcutLastPage'),
    context: 'viewer',
  },
  {
    key: 'Ctrl+Plus',
    handler: () => console.log('Zoom in'),
      description: t('pdf', 'shortcutZoomIn'),
    context: 'viewer',
  },
  {
    key: 'Ctrl+Minus',
    handler: () => console.log('Zoom out'),
      description: t('pdf', 'shortcutZoomOut'),
    context: 'viewer',
  },
  {
    key: 'Ctrl+0',
    handler: () => console.log('Reset zoom'),
      description: t('pdf', 'shortcutResetZoom'),
    context: 'viewer',
  },
  {
    key: 'Ctrl+F',
    handler: () => console.log('Find'),
      description: t('pdf', 'shortcutFind'),
    context: 'viewer',
  },
  {
    key: 'Escape',
    handler: () => console.log('Cancel'),
      description: t('pdf', 'shortcutCancel'),
    context: 'global',
  },
  {
    key: 'F11',
    handler: () => console.log('Presentation mode'),
      description: t('pdf', 'shortcutPresentation'),
    context: 'viewer',
  },
  {
    key: 'Ctrl+P',
    handler: () => console.log('Print'),
      description: t('pdf', 'shortcutPrint'),
    context: 'viewer',
  },
];

