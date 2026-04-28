/**
 * Footer theme toggle: cycles light → dark → system.
 */
import React from 'react';
import {Moon, Monitor, Sun} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useTheme} from '@/contexts/ThemeContext';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({className}) => {
  const {theme, cycle} = useTheme();
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={t('layout', 'themeToggleAriaLabel')}
      className={cn('h-7 w-7 hover:bg-muted/50 text-muted-foreground hover:text-foreground', className)}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </Button>
  );
};

export default ThemeToggle;
