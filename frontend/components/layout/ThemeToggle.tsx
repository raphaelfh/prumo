/**
 * Footer theme toggle: cycles light → dark → system.
 */
import React from 'react';
import {Moon, Monitor, Sun} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {useTheme} from '@/contexts/ThemeContext';
import {t} from '@/lib/copy';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({className}) => {
  const {theme, cycle} = useTheme();
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <IconButton
      label={t('layout', 'themeToggleAriaLabel')}
      onClick={cycle}
      className={className}
      icon={<Icon strokeWidth={1.5} />}
    />
  );
};

