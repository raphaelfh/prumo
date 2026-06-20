import { t } from '@/lib/copy';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export interface CommandAction {
  id: string;
  label: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actions: CommandAction[];
  articles?: { id: string; title: string }[];
  onNavigate?: (id: string) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
  articles,
  onNavigate,
}: CommandPaletteProps) {
  const hasArticles = articles && articles.length > 0 && onNavigate != null;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t('runs', 'commandPlaceholder')} />
      <CommandList>
        <CommandEmpty>{t('runs', 'commandEmpty')}</CommandEmpty>
        {actions.length > 0 && (
          <CommandGroup heading={t('runs', 'commandActions')}>
            {actions.map((action) => (
              <CommandItem
                key={action.id}
                onSelect={() => {
                  action.run();
                  onOpenChange(false);
                }}
              >
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {hasArticles && (
          <CommandGroup heading={t('runs', 'commandGoToArticle')}>
            {articles!.map((article) => (
              <CommandItem
                key={article.id}
                onSelect={() => {
                  onNavigate!(article.id);
                  onOpenChange(false);
                }}
              >
                {article.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
