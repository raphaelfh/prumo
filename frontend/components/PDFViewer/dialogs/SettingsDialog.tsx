/**
 * SettingsDialog - Dialog de configurações do PDF Viewer
 * 
 * Features:
 * - Configurações de visualização
 * - Atalhos de teclado
 */

import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,} from '@/components/ui/dialog';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Keyboard} from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const shortcuts = [
    { keys: 'PageDown / PageUp', action: 'Navegar entre páginas' },
    { keys: 'Home / End', action: 'Primeira / Última página' },
    { keys: 'Ctrl + / Ctrl -', action: 'Zoom In / Out' },
    { keys: 'Ctrl 0', action: 'Resetar zoom' },
    { keys: 'Ctrl F', action: 'Buscar no documento' },
    { keys: 'Escape', action: 'Fechar diálogos' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Configurações do PDF Viewer</DialogTitle>
          <DialogDescription>
            Personalize sua experiência de visualização de PDFs
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">Geral</TabsTrigger>
            <TabsTrigger value="shortcuts">Atalhos</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 pt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Sobre</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>PDF Viewer v2.0</p>
                  <p>Baseado em PDF.js e React-PDF</p>
                  <p className="text-xs mt-2">
                    © 2025 Review Hub - Sistema de Revisão Sistemática
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts" className="pt-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Keyboard className="h-4 w-4" />
                <span>Atalhos de Teclado Disponíveis</span>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50"
                  >
                    <span className="text-sm">{shortcut.action}</span>
                    <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground mt-4">
                Dica: Pressione <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">?</kbd> para ver esta lista
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
