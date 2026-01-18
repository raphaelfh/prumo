/**
 * Keyboard Shortcuts - Gerenciador de atalhos de teclado
 * 
 * Features:
 * - Registro centralizado de atalhos
 * - Prevenção de conflitos
 * - Contextos de atalhos (global, viewer, etc)
 * - Help/overlay com lista de atalhos
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
   * Normalizar tecla para formato consistente
   */
  private normalizeKey(event: KeyboardEvent): string {
    const parts: string[] = [];
    
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');
    
    // Normalizar tecla principal
    const key = event.key.length === 1 
      ? event.key.toUpperCase() 
      : event.key;
    
    parts.push(key);
    
    return parts.join('+');
  }

  /**
   * Registrar atalho
   */
  register(shortcut: Shortcut): void {
    this.shortcuts.set(shortcut.key, shortcut);
  }

  /**
   * Remover atalho
   */
  unregister(key: ShortcutKey): void {
    this.shortcuts.delete(key);
  }

  /**
   * Lidar com evento de teclado
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
   * Habilitar/desabilitar atalhos
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Obter todos os atalhos
   */
  getAllShortcuts(): Shortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Obter atalhos por contexto
   */
  getShortcutsByContext(context: 'global' | 'viewer' | 'edit'): Shortcut[] {
    return Array.from(this.shortcuts.values())
      .filter(s => s.context === context || !s.context);
  }
}

// Instância singleton
export const keyboardManager = new KeyboardShortcutManager();

/**
 * Hook para usar atalhos de teclado
 */
import { useEffect } from 'react';

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
 * Atalhos padrão do PDFViewer
 */
export const defaultShortcuts: Shortcut[] = [
  // Navegação
  {
    key: 'PageDown',
    handler: () => console.log('Next page'),
    description: 'Próxima página',
    context: 'viewer',
  },
  {
    key: 'PageUp',
    handler: () => console.log('Previous page'),
    description: 'Página anterior',
    context: 'viewer',
  },
  {
    key: 'Home',
    handler: () => console.log('First page'),
    description: 'Primeira página',
    context: 'viewer',
  },
  {
    key: 'End',
    handler: () => console.log('Last page'),
    description: 'Última página',
    context: 'viewer',
  },
  // Zoom
  {
    key: 'Ctrl+Plus',
    handler: () => console.log('Zoom in'),
    description: 'Aumentar zoom',
    context: 'viewer',
  },
  {
    key: 'Ctrl+Minus',
    handler: () => console.log('Zoom out'),
    description: 'Reduzir zoom',
    context: 'viewer',
  },
  {
    key: 'Ctrl+0',
    handler: () => console.log('Reset zoom'),
    description: 'Resetar zoom',
    context: 'viewer',
  },
  // Ferramentas
  {
    key: 'Ctrl+F',
    handler: () => console.log('Find'),
    description: 'Buscar no documento',
    context: 'viewer',
  },
  {
    key: 'Escape',
    handler: () => console.log('Cancel'),
    description: 'Cancelar ação atual',
    context: 'global',
  },
  // Visualização
  {
    key: 'F11',
    handler: () => console.log('Presentation mode'),
    description: 'Modo apresentação',
    context: 'viewer',
  },
  {
    key: 'Ctrl+P',
    handler: () => console.log('Print'),
    description: 'Imprimir',
    context: 'viewer',
  },
];

