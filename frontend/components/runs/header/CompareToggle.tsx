import { Columns2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CompareToggleProps {
  /** True when the comparison view is currently active. */
  active: boolean;
  onToggle: () => void;
  label: string;
}

/**
 * Visible top-level toggle for the run's core review action — switching into the
 * side-by-side reviewer comparison. Promoted out of the kebab because, for a HITL
 * tool, reconciling reviewers is the reason the screen exists; it should never be
 * a hidden menu item. Mirrors AIActions' responsive treatment: a labelled ghost
 * button that collapses to its icon below 48rem (the name survives via
 * `aria-label`). `aria-pressed` carries the on/off state.
 */
export function CompareToggle({ active, onToggle, label }: CompareToggleProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      className={cn('shrink-0 gap-1.5 whitespace-nowrap', active && 'bg-muted text-foreground')}
    >
      <Columns2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      <span className="hidden @[48rem]/headerbar:inline">{label}</span>
    </Button>
  );
}
