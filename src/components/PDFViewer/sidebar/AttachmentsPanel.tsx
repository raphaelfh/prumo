/**
 * AttachmentsPanel - Painel de anexos do PDF
 * 
 * Features:
 * - Lista de anexos nativos do PDF
 * - Download de anexos
 * - Visualização de metadados
 * 
 * Nota: Será implementado quando houver PDFs com anexos para testar.
 * Por ora, mostra placeholder.
 */

import { Paperclip } from 'lucide-react';

export function AttachmentsPanel() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <Paperclip className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="font-semibold text-sm mb-2">Sem Anexos</h3>
      <p className="text-xs text-muted-foreground">
        Este documento não possui anexos.
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        Anexos incorporados no PDF serão listados aqui.
      </p>
    </div>
  );
}

