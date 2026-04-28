/**
 * Generic placeholder for tabs whose page hasn't been implemented yet.
 */
import React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Sparkles} from 'lucide-react';
import {t} from '@/lib/copy';

interface ComingSoonPanelProps {
  title: string;
  icon?: LucideIcon;
  description?: string;
}

export const ComingSoonPanel: React.FC<ComingSoonPanelProps> = ({title, icon: Icon = Sparkles, description}) => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
    <div className="h-12 w-12 rounded-full bg-muted/40 flex items-center justify-center mb-4 border border-border/40">
      <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
    </div>
    <h2 className="text-[15px] font-medium text-foreground mb-1">{title}</h2>
    <p className="text-[13px] text-muted-foreground max-w-sm">
      {description ?? t('layout', 'comingSoonBody')}
    </p>
  </div>
);

export default ComingSoonPanel;
