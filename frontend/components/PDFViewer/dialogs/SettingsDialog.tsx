/**
 * SettingsDialog - PDF Viewer settings dialog
 * Features: view settings, keyboard shortcuts
 */

import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,} from '@/components/ui/dialog';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Keyboard} from 'lucide-react';
import {t} from '@/lib/copy';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const shortcuts = [
      {keys: 'PageDown / PageUp', action: t('pdf', 'settingsShortcutNavigatePages')},
      {keys: 'Home / End', action: t('pdf', 'settingsShortcutFirstLastPage')},
      {keys: 'Ctrl + / Ctrl -', action: t('pdf', 'settingsShortcutZoomInOut')},
      {keys: 'Ctrl 0', action: t('pdf', 'settingsShortcutResetZoom')},
      {keys: 'Ctrl F', action: t('pdf', 'settingsShortcutFind')},
      {keys: 'Escape', action: t('pdf', 'settingsShortcutCloseDialogs')},
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
            <DialogTitle>{t('pdf', 'settingsTitle')}</DialogTitle>
          <DialogDescription>
              {t('pdf', 'settingsDesc')}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="general">{t('pdf', 'settingsTabGeneral')}</TabsTrigger>
              <TabsTrigger value="shortcuts">{t('pdf', 'settingsTabShortcuts')}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 pt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                  <h4 className="text-sm font-medium">{t('pdf', 'settingsAboutTitle')}</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                    <p>{t('pdf', 'settingsAboutVersion')}</p>
                    <p>{t('pdf', 'settingsAboutBased')}</p>
                  <p className="text-xs mt-2">
                      {t('pdf', 'settingsAboutCopyright')}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts" className="pt-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Keyboard className="h-4 w-4" />
                  <span>{t('pdf', 'settingsShortcutsAvailable')}</span>
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
                  {t('pdf', 'settingsTipShortcutBefore')}<kbd
                  className="px-1 py-0.5 bg-muted rounded text-[10px]">?</kbd>{t('pdf', 'settingsTipShortcutAfter')}
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
