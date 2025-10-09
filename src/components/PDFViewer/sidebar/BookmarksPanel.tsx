/**
 * BookmarksPanel - Painel de marcadores/favoritos do usuário
 * 
 * Features:
 * - Criar bookmarks personalizados
 * - Organizar bookmarks
 * - Navegação rápida
 * 
 * Nota: Funcionalidade completa será implementada futuramente.
 * Por ora, mostra placeholder.
 */

import { Bookmark } from 'lucide-react';

export function BookmarksPanel() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <Bookmark className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="font-semibold text-sm mb-2">Sem Marcadores</h3>
      <p className="text-xs text-muted-foreground">
        Crie marcadores personalizados para páginas importantes.
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        Funcionalidade em desenvolvimento.
      </p>
    </div>
  );
}

