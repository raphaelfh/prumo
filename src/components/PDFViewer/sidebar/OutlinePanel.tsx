/**
 * OutlinePanel - Painel de sumário/índice do PDF
 * 
 * Features:
 * - Exibir Table of Contents nativa do PDF
 * - Navegação hierárquica
 * - Clique para ir à página/seção
 * 
 * Nota: Será totalmente implementado quando tivermos PDFs com TOC.
 * Por ora, mostra placeholder.
 */

import { List } from 'lucide-react';

export function OutlinePanel() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <List className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="font-semibold text-sm mb-2">Sem Sumário</h3>
      <p className="text-xs text-muted-foreground">
        Este documento não possui um sumário (Table of Contents).
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        Será exibido automaticamente para documentos com TOC.
      </p>
    </div>
  );
}

